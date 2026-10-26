import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { pageText, pageSize, countIn } from '@/lib/pdf';
import { pageToJpeg, jpegName } from '@/lib/pageJpeg';
import { useDoc } from '@/context/DocContext';
import { useTabActive } from '@/context/TabsContext';
import SheetView from '@/components/app/SheetView';
import CleanScanDialog from '@/components/app/CleanScanDialog';
import { clearWhite, readPicture } from '@/lib/insertImage';
import SignaturesMenu from '@/components/app/SignaturesMenu';
import { saveSignature, type Signature } from '@/lib/signatures';
import type { StampSource } from '@/components/app/sheet/useCloneStamp';
import { onSearchRequest } from '@/lib/searchBus';
import { requestPrint } from '@/lib/printBus';
import { downloadBlob, expectRename } from '@/lib/files';
import { toast } from '@/hooks/use-toast';
import { readNotes, saveNotes, makeNote, readAuthor, saveAuthor } from '@/lib/notes';
import { notesChanged, onNotesChanged, openNotes } from '@/lib/noteBus';

export type Tool =
  | 'hand'
  | 'pan'
  | 'text'
  | 'block'
  | 'note'
  | 'arrow'
  | 'line'
  | 'rect'
  | 'oval'
  | 'stamp';

// Размер кисти штампа, в точках экрана
const STAMP_MIN = 4;
const STAMP_MAX = 200;

// Цвета рецензирования: жёлтый маркер и красная линия — привычные
// по бумажным документам
const PEN = { mark: '#FFE14D', line: '#D93025' };

// Готовые цвета заливки: чёрным скрывают сведения, белым убирают
// лишнее с листа, серый и бежевый подходят под бланки на цветной бумаге
const FILLS = [
  { value: '#14181C', title: 'Чёрный — скрыть сведения' },
  { value: '#FFFFFF', title: 'Белый — убрать с листа' },
  { value: '#E8E8E8', title: 'Светло-серый' },
  { value: '#F5EFE0', title: 'Бежевый — под цвет бланка' },
];

type Props = { tool: Tool; setTool: (t: Tool) => void };

// Предел увеличения. 300% не хватало, чтобы разобрать мелкие
// подписи и размеры на чертеже, поэтому подняли до 800%
const MAX_ZOOM = 8;

// Шаг увеличения: не фиксированные 20%, а доля от текущего масштаба.
// Раньше от 100% до предела было больше двадцати нажатий, а на
// сильном увеличении шаг ощущался неразличимо мелким
const zoomIn = (z: number) => Math.min(MAX_ZOOM, +(z * 1.25).toFixed(2));
const zoomOut = (z: number) => Math.max(0.05, +(z / 1.25).toFixed(2));

// Готовые ступени масштаба. Крупные нужны, чтобы разобрать мелкие
// подписи на чертеже, не щёлкая «плюс» десяток раз
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

const Viewer = ({ tool, setTool }: Props) => {
  const {
    pages,
    active,
    setActive,
    docOf,
    rotate,
    annots,
    addAnnot,
    updateAnnot,
    removeAnnot,
    remove,
    buildPdf,
    name,
    renameDoc,
  } = useDoc();
  // Клавиши слушает только вкладка, открытая на экране
  const onScreen = useTabActive();
  const scroller = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Пока идёт переход к странице по кнопке, номер не пересчитываем
  const jumping = useRef(false);
  // Через эту ссылку клавиша F3 попадает к переходу по находкам
  const jumpRef = useRef<(dir: number) => void>(() => undefined);
  const [zoom, setZoomRaw] = useState(1.2);
  // Открыт ли список готовых масштабов
  const [zoomList, setZoomList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[] | null>(null);
  // Что именно ищем сейчас — по нему подсвечиваем найденное на странице
  const [found, setFound] = useState('');
  // Все совпадения по порядку: страница и номер совпадения на ней.
  // По ним считается «3 из 12» и идёт переход по F3
  const [matches, setMatches] = useState<{ page: number; k: number; n: number }[]>([]);
  const [cur, setCur] = useState(0);
  // Номер перехода: при каждом переходе текущее совпадение
  // подводится в поле зрения, даже если оно то же самое
  const [jumpSeq, setJumpSeq] = useState(0);
  const clearSearch = () => {
    setHits(null);
    setFound('');
    setMatches([]);
    setCur(0);
  };
  // Разворот: два листа рядом, как в раскрытой книге.
  // Выбор запоминается до следующего запуска программы
  const [spread, setSpread] = useState(() => {
    try {
      return localStorage.getItem('pvs-spread') === '1';
    } catch {
      return false;
    }
  });

  // Подгонка масштаба: по ширине окна или страница целиком.
  // Пока режим включён, масштаб пересчитывается при смене размера окна
  const [fit, setFit] = useState<'none' | 'width' | 'page'>('none');

  // Цвет заливки. Чёрным скрывают сведения, белым — убирают лишнее
  // с листа, а пипеткой берут цвет прямо с бланка, чтобы заплатка
  // не бросалась в глаза. Выбор запоминается до следующего запуска
  const [fill, setFillRaw] = useState(() => {
    try {
      return localStorage.getItem('pvs-fill') || '#14181C';
    } catch {
      return '#14181C';
    }
  });
  const setFill = (c: string) => {
    setFillRaw(c);
    try {
      localStorage.setItem('pvs-fill', c);
    } catch {
      /* хранилище недоступно — не страшно */
    }
  };

  // Пипетка: следующий щелчок по странице возьмёт цвет из этой точки
  const [picking, setPicking] = useState(false);

  // Окно «Очистить фон скана»
  const [cleaning, setCleaning] = useState(false);

  // Вставленные картинки (подпись, печать): какая выбрана для правки
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  // Файл выбирают для «Моих подписей» — после вставки сразу запоминаем
  const saveNextPicture = useRef(false);

  // Штамп: размер и мягкость кисти запоминаются до следующего запуска,
  // источник — только на время работы с документом
  const [stampSize, setStampSizeRaw] = useState(() => {
    const v = Number(localStorage.getItem('pvs-stamp-size'));
    return v >= STAMP_MIN && v <= STAMP_MAX ? v : 24;
  });
  const [stampSoft, setStampSoftRaw] = useState(() => {
    const v = localStorage.getItem('pvs-stamp-soft');
    return v !== null && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : 50;
  });
  const setStampSize = useCallback((v: number | ((p: number) => number)) => {
    setStampSizeRaw((prev) => {
      const next = Math.round(Math.min(STAMP_MAX, Math.max(STAMP_MIN, typeof v === 'function' ? v(prev) : v)));
      try {
        localStorage.setItem('pvs-stamp-size', String(next));
      } catch {
        /* хранилище недоступно — не страшно */
      }
      return next;
    });
  }, []);
  const setStampSoft = (v: number) => {
    setStampSoftRaw(v);
    try {
      localStorage.setItem('pvs-stamp-soft', String(v));
    } catch {
      /* хранилище недоступно — не страшно */
    }
  };
  // Режим штампа: обычный переносит пиксели как есть, восстанавливающий
  // подгоняет цвет и яркость заплатки под фон вокруг помарки
  const [stampHeal, setStampHealRaw] = useState(() => localStorage.getItem('pvs-stamp-heal') === '1');
  const setStampHeal = (v: boolean) => {
    setStampHealRaw(v);
    try {
      localStorage.setItem('pvs-stamp-heal', v ? '1' : '0');
    } catch {
      /* хранилище недоступно — не страшно */
    }
  };
  const [stampSource, setStampSource] = useState<StampSource | null>(null);
  const [stampChoosing, setStampChoosing] = useState(false);
  const stamp = useMemo(
    () => ({
      size: stampSize,
      soft: stampSoft,
      heal: stampHeal,
      source: stampSource,
      setSource: setStampSource,
      choosing: stampChoosing,
      setChoosing: setStampChoosing,
    }),
    [stampSize, stampSoft, stampHeal, stampSource, stampChoosing],
  );

  // Клавиши [ и ] меняют размер кисти, как в Фотошопе.
  // Shift — шаг крупнее
  useEffect(() => {
    if (tool !== 'stamp' || !onScreen) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const bigger = e.code === 'BracketRight';
      const smaller = e.code === 'BracketLeft';
      if (!bigger && !smaller) return;
      e.preventDefault();
      setStampSize((v) => {
        const step = e.shiftKey ? 20 : v < 20 ? 2 : v < 60 ? 5 : 10;
        return v + (bigger ? step : -step);
      });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tool, onScreen, setStampSize]);

  // Заплатка от штампа становится обычной пометкой: её отменяет Ctrl+Z
  const patch = useCallback(
    (target: (typeof pages)[number], x: number, y: number, w: number, h: number, img: string) => {
      addAnnot({ pageUid: target.uid, x, y, w, h, img, text: '', size: 0, color: '', kind: 'patch' });
    },
    [addAnnot],
  );

  // Картинка встаёт посередине текущей страницы. Ширина по умолчанию —
  // 5 см, как у обычной подписи; узкая высокая картинка (печать)
  // ограничивается по высоте. Дальше её двигают и тянут за углы
  const MM = 72 / 25.4;

  // Поставить картинку на середину текущей страницы. Размер — в мм:
  // у сохранённой подписи свой, у новой — 5 см в ширину, как обычно
  const placePicture = useCallback(
    async (img: string, wMm: number, hMm: number, angle = 0, clear = false) => {
      const target = pages[active];
      const doc = target && docOf(target);
      if (!target || !doc) return null;
      const size = await pageSize(doc, target.src, target.rotation);
      let wPt = wMm * MM;
      let hPt = hMm * MM;
      // Лист меньше подписи (например, узкий чек) — уменьшаем
      const k = Math.min(1, (size.w * 0.9) / wPt, (size.h * 0.9) / hPt);
      wPt *= k;
      hPt *= k;
      const w = wPt / size.w;
      const h = hPt / size.h;
      const id = addAnnot({
        pageUid: target.uid,
        kind: 'image',
        img,
        x: (1 - w) / 2,
        y: (1 - h) / 2,
        w,
        h,
        angle: angle || undefined,
        text: clear ? 'clear' : '',
        size: 0,
        color: '',
      });
      setTool('hand');
      setSelectedImage(id);
      return id;
    },
    [pages, active, docOf, addAnnot, setTool, MM],
  );

  const insertPicture = useCallback(
    async (file: File) => {
      try {
        const pic = await readPicture(file);
        let wMm = 50;
        let hMm = (wMm * pic.h) / pic.w;
        if (hMm > 40) {
          wMm *= 40 / hMm;
          hMm = 40;
        }
        const id = await placePicture(pic.src, wMm, hMm);
        if (!id) return;
        if (saveNextPicture.current) {
          saveNextPicture.current = false;
          await saveSignature({ name: file.name.replace(/\.(png|jpe?g)$/i, '') || 'Подпись', img: pic.src, wMm, hMm });
          toast({
            title: 'Подпись добавлена в «Мои подписи»',
            description: 'Поправьте размер на листе и нажмите «В мои подписи», чтобы запомнить его',
          });
          return;
        }
        toast({
          title: 'Картинка вставлена',
          description: 'Перетащите её на место, размер — за углы, поворот — за кружок сверху',
        });
      } catch (e) {
        saveNextPicture.current = false;
        toast({ title: 'Не удалось вставить', description: e instanceof Error ? e.message : '' });
      }
    },
    [placePicture],
  );

  // Сохранённая подпись — на страницу одним щелчком
  const pickSignature = useCallback(
    (sg: Signature) => void placePicture(sg.img, sg.wMm, sg.hMm, sg.rotation ?? 0, true),
    [placePicture],
  );

  // Запомнить картинку с листа вместе с её нынешним размером и поворотом
  const rememberImage = useCallback(
    async (id: string) => {
      const m = annots.find((a) => a.id === id);
      const target = m && pages.find((p) => p.uid === m.pageUid);
      const doc = target && docOf(target);
      if (!m?.img || !target || !doc) return;
      const size = await pageSize(doc, target.src, target.rotation);
      const name = (window.prompt('Название подписи', 'Моя подпись') || '').trim();
      if (!name) return;
      try {
        await saveSignature({
          name,
          img: m.img,
          wMm: ((m.w ?? 0.2) * size.w) / MM,
          hMm: ((m.h ?? 0.08) * size.h) / MM,
          rotation: m.angle || undefined,
        });
        toast({ title: 'Сохранено в «Мои подписи»', description: `«${name}» теперь ставится одним щелчком` });
      } catch (e) {
        toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : '' });
      }
    },
    [annots, pages, docOf, MM],
  );

  const moveImage = useCallback(
    (id: string, box: { x: number; y: number; w: number; h: number; angle?: number }) => {
      const m = annots.find((a) => a.id === id);
      const turned = (box.angle ?? 0) !== (m?.angle ?? 0);
      updateAnnot(id, { ...box, angle: box.angle || undefined }, turned ? 'поворот картинки' : 'перемещение картинки');
    },
    [annots, updateAnnot],
  );

  // Убрать белый фон: картинка становится прозрачной вокруг чернил,
  // пустые поля обрезаются, а сама подпись остаётся на прежнем месте
  const clearImageBg = useCallback(
    async (id: string) => {
      const m = annots.find((a) => a.id === id);
      if (!m?.img) return;
      try {
        const res = await clearWhite(m.img);
        const w = m.w ?? 0.2;
        const h = m.h ?? 0.08;
        const c = res.crop;
        const box = c
          ? {
              x: m.x + (c.x0 / c.w) * w,
              y: m.y + (c.y0 / c.h) * h,
              w: (c.cw / c.w) * w,
              h: (c.ch / c.h) * h,
            }
          : { x: m.x, y: m.y, w, h };
        // text — отметка «фон уже убран», чтобы не предлагать снова
        updateAnnot(id, { ...box, img: res.src, text: 'clear' }, 'удаление белого фона');
      } catch (e) {
        toast({ title: 'Не удалось убрать фон', description: e instanceof Error ? e.message : '' });
      }
    },
    [annots, updateAnnot],
  );

  // Вставка картинки из буфера обмена: скопировали подпись в другой
  // программе — Ctrl+V кладёт её на текущую страницу
  useEffect(() => {
    if (!onScreen) return;
    const paste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => /^image\/(png|jpeg)$/.test(f.type));
      if (!file) return;
      e.preventDefault();
      void insertPicture(file);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [onScreen, insertPicture]);

  // Заметки документа: значки рисуются на листах, тексты — в панели
  const [notes, setNotes] = useState(() => readNotes(name));
  useEffect(() => setNotes(readNotes(name)), [name]);
  useEffect(() => onNotesChanged(() => setNotes(readNotes(name))), [name]);

  // Новая заметка в точке щелчка. Имя рецензента спрашиваем один раз
  const addNote = useCallback(
    (target: typeof pages[number], x: number, y: number) => {
      let who = readAuthor();
      if (!who) {
        who = (window.prompt('Ваше имя для замечаний') || '').trim();
        if (!who) return;
        saveAuthor(who);
      }
      const at = pages.indexOf(target);
      const note = makeNote(at, x, y, who);
      const quote = (window.getSelection()?.toString() || '').trim();
      if (quote) note.quote = quote.slice(0, 160);
      const next = [...readNotes(name), note];
      saveNotes(name, next);
      setNotes(next);
      openNotes();
      notesChanged(note.id);
      setTool('hand');
    },
    [pages, name, setTool],
  );

  // Размер первой страницы — ориентир для всей ленты. Благодаря ему полоса
  // прокрутки сразу верной длины, а файл не читается целиком ради размеров
  const [hint, setHint] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let off = false;
    const first = pages[0];
    const doc = first && docOf(first);
    if (!doc) {
      setHint(null);
      return;
    }
    pageSize(doc, first.src, first.rotation)
      .then((s) => !off && setHint(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [pages, docOf]);

  // Точка окна, которая должна остаться на месте при смене масштаба.
  // Пусто — середина окна
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const prevZoom = useRef(zoom);
  const lastScroll = useRef({ top: 0, left: 0 });

  // При смене масштаба лента растёт или сжимается. Без подстройки
  // прокрутки место, которое человек разглядывал, уезжало: при
  // увеличении окно смотрело в левый верхний угол, а не туда же.
  // Пересчитываем прокрутку так, чтобы точка документа под курсором
  // (или в середине окна) осталась на месте
  useLayoutEffect(() => {
    const box = scroller.current;
    const was = prevZoom.current;
    prevZoom.current = zoom;
    if (!box || was === zoom) return;

    const k = zoom / was;
    const at = anchor.current ?? { x: box.clientWidth / 2, y: box.clientHeight / 2 };
    anchor.current = null;

    // Лента уже перестроена под новый масштаб. Старое положение каждого
    // листа восстанавливаем расчётом: растягиваются только сами листы,
    // а поля ленты, промежутки и подписи «Стр. N» остаются прежними
    const PAD = 24;
    const sheets = Array.from(box.querySelectorAll<HTMLElement>('[data-sheet]'));
    if (!sheets.length) return;

    // Листы одного ряда (разворот) стоят на одной высоте — берём ряды
    const rowsTop: { el: HTMLElement; top: number }[] = [];
    for (const el of sheets) {
      const last = rowsTop[rowsTop.length - 1];
      if (!last || Math.abs(last.top - el.offsetTop) > 1) rowsTop.push({ el, top: el.offsetTop });
    }
    const first = rowsTop[0].el;
    const inner = first.firstElementChild as HTMLElement | null;
    // Постоянная часть ряда: промежуток и подпись под листом
    // (вместе с отступом до следующего листа — его offsetHeight не видит)
    const fixed = inner
      ? rowsTop.length > 1
        ? rowsTop[1].top - rowsTop[0].top - inner.offsetHeight
        : first.offsetHeight - inner.offsetHeight
      : 0;

    const oldTop = (r: number) => PAD + r * fixed + (rowsTop[r].top - PAD - r * fixed) / k;

    // Прокрутку берём ту, что была ДО перестройки: при уменьшении браузер
    // успевает урезать её под короткую ленту, и расчёт съезжал бы
    const was2 = lastScroll.current;
    const oldY = was2.top + at.y;
    let r = 0;
    while (r + 1 < rowsTop.length && oldTop(r + 1) <= oldY) r++;

    const oTop = oldTop(r);
    const rowEl = rowsTop[r].el;
    const sheetH = (rowEl.firstElementChild as HTMLElement | null)?.offsetHeight ?? rowEl.offsetHeight;
    // Точка внутри листа — растягивается; в подписи под листом — нет
    const inside = oldY - oTop;
    const oldH = sheetH / k;
    const newY =
      inside <= oldH ? rowsTop[r].top + inside * k : rowsTop[r].top + sheetH + (inside - oldH);
    box.scrollTop = Math.max(0, newY - at.y);

    // По горизонтали листы стоят по центру ленты. Ширина ленты — по самому
    // широкому листу, но не меньше окна
    const newW = box.scrollWidth;
    const contentNew = newW - PAD * 2;
    const oldW = Math.max(box.clientWidth, contentNew / k + PAD * 2);
    const centerNew = newW / 2;
    const centerOld = oldW / 2;
    const oldX = was2.left + at.x;
    const newX = centerNew + (oldX - centerOld) * k;
    box.scrollLeft = Math.max(0, newX - at.x);
    lastScroll.current = { top: box.scrollTop, left: box.scrollLeft };
  }, [zoom]);

  // Последнее положение прокрутки — до того, как лента перестроится
  // под новый масштаб
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const keep = () => (lastScroll.current = { top: box.scrollTop, left: box.scrollLeft });
    keep();
    box.addEventListener('scroll', keep, { passive: true });
    return () => box.removeEventListener('scroll', keep);
  }, []);

  // Как только масштаб меняют вручную, подгонка выключается
  const setZoom: typeof setZoomRaw = (v) => {
    setFit('none');
    setZoomRaw(v);
  };

  const page = pages[active];

  // В режиме разворота листы идут парами: первая страница — обложка,
  // дальше чётная слева и нечётная справа, как в печатной книге
  const rows = useMemo(() => {
    if (!spread) return pages.map((p, i) => [{ p, i }]);
    const out: { p: (typeof pages)[number]; i: number }[][] = [];
    if (pages[0]) out.push([{ p: pages[0], i: 0 }]);
    for (let i = 1; i < pages.length; i += 2) {
      const pair = [{ p: pages[i], i }];
      if (pages[i + 1]) pair.push({ p: pages[i + 1], i: i + 1 });
      out.push(pair);
    }
    return out;
  }, [pages, spread]);

  // Номер страницы, к которому лента уже подведена. Пока он совпадает
  // с текущим, самовольных перелётов не делаем
  const lastJump = useRef(active);

  // Подводим ленту к нужному месту. Вблизи — плавно, издалека — сразу:
  // на длинном документе плавный перелёт через тысячи листов идёт долго
  // и рвано, ведь листы вдали ещё не нарисованы и их высота уточняется
  // на лету, из-за чего цель уезжает прямо во время движения
  const scrollTo = useCallback((top: number) => {
    const box = scroller.current;
    if (!box) return;
    const target = Math.max(0, top);
    const far = Math.abs(target - box.scrollTop) > box.clientHeight * 3;
    jumping.current = true;
    box.scrollTo({ top: target, behavior: far ? 'auto' : 'smooth' });
    // Пока лента едет, номер страницы не пересчитываем: иначе
    // промежуточные листы перебивали бы выбранную цель
    window.setTimeout(() => (jumping.current = false), far ? 60 : 420);
  }, []);

  const scrollToPage = useCallback(
    (i: number) => {
      const box = scroller.current;
      const el = box?.querySelector(`[data-sheet="${i}"]`) as HTMLElement | null;
      if (!el) return;
      scrollTo(el.offsetTop - 24);
    },
    [scrollTo],
  );

  // Считаем масштаб так, чтобы лист вписался в окно
  const applyFit = useCallback(
    async (mode: 'width' | 'page') => {
      const box = scroller.current;
      const target = pages[active];
      if (!box || !target) return;
      const doc = docOf(target);
      if (!doc) return;
      const size = await pageSize(doc, target.src, target.rotation);
      // Поля вокруг листа и место под полосу прокрутки
      const padX = 64 + (spread ? 16 + size.w : 0);
      const padY = 88;
      const byWidth = (box.clientWidth - padX) / size.w;
      const scale = mode === 'width' ? byWidth : Math.min(byWidth, (box.clientHeight - padY) / size.h);
      // Нижнюю границу опустили с 20% до 5%: вытянутый чертёж
      // (длинная схема, развёртка) требует сильного уменьшения,
      // и на 20% он всё равно не помещался целиком
      setZoomRaw(Math.max(0.05, Math.min(MAX_ZOOM, +scale.toFixed(2))));
    },
    [pages, active, docOf, spread],
  );

  // Крупный лист показываем целиком с самого начала.
  //
  // Раньше любой документ открывался с жёстким увеличением 120%.
  // Для A4 это удобно, а чертёж A1 больше листа A4 вчетверо — он
  // уходил далеко за края окна, и охватить схему взглядом было
  // нельзя, пока человек сам не нажмёт «страница целиком».
  // Считаем по площади: лист заметно крупнее A4 — вписываем
  const fitted = useRef('');

  useEffect(() => {
    const first = pages[0];
    if (!hint || !first) return;

    // Один документ подгоняем один раз, иначе подгонка перебивала бы
    // масштаб, выставленный человеком вручную
    const mark = `${name}|${pages.length}`;
    if (fitted.current === mark) return;
    fitted.current = mark;

    // A4 — 595x842 точки. Берём запас в полтора раза по площади,
    // чтобы обычные бланки с полями остались в привычном виде
    const big = hint.w * hint.h > 595 * 842 * 1.5;
    if (big) setFit('page');
  }, [hint, pages, name]);

  // Список масштабов закрывается сам: щелчком мимо или клавишей Esc.
  // Иначе он оставался бы висеть поверх документа
  useEffect(() => {
    if (!zoomList) return;
    const away = () => setZoomList(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setZoomList(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [zoomList]);

  // Пока подгонка включена, масштаб следует за размером окна
  useEffect(() => {
    if (fit === 'none') return;
    applyFit(fit);
    const onResize = () => applyFit(fit);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit, applyFit]);

  const toggleSpread = () => {
    const next = !spread;
    setSpread(next);
    try {
      localStorage.setItem('pvs-spread', next ? '1' : '0');
    } catch {
      /* хранилище недоступно — не страшно */
    }
    // В развороте два листа рядом, поэтому масштаб уменьшается.
    // Если включена подгонка, она сама пересчитается под новый вид
    if (fit === 'none') {
      setZoomRaw((z) =>
        next ? Math.max(0.1, +(z * 0.62).toFixed(2)) : Math.min(MAX_ZOOM, +(z / 0.62).toFixed(2)),
      );
    }
    setTimeout(() => scrollToPage(active), 80);
  };

  const go = useCallback(
    (step: number) => {
      // В развороте кнопка перелистывает сразу пару листов
      const size = spread && active > 0 ? 2 : 1;
      const next = Math.min(pages.length - 1, Math.max(0, active + step * size));
      setActive(next);
      scrollToPage(next);
    },
    [pages.length, setActive, active, scrollToPage, spread],
  );

  // Управление с клавиатуры: стрелки и PageUp/PageDown листают страницы,
  // Ctrl и + / - меняют масштаб, Home и End — первая и последняя страница
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!onScreen) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

      // Пока открыто окно печати или другое диалоговое окно, клавиши не трогаем
      if (document.querySelector('.fixed.inset-0')) return;

      // Ctrl+F ставит курсор в поле поиска и выделяет прежний запрос,
      // чтобы сразу можно было набрать новый
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
        return;
      }

      // Escape в поле поиска убирает подсветку и возвращает управление документу
      if (e.key === 'Escape' && typing) {
        e.preventDefault();
        clearSearch();
        setQuery('');
        searchBox.current?.blur();
        return;
      }

      // F3 — переход к следующей найденной странице
      if (e.key === 'F3') {
        e.preventDefault();
        jumpRef.current(e.shiftKey ? -1 : 1);
        return;
      }

      // Shift+Ctrl+D удаляет страницу, на которой человек сейчас находится
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyD' || e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        const cur = pages[active];
        if (!cur) return;
        if (pages.length < 2) {
          toast({ title: 'Это единственная страница', description: 'Удалить её нельзя' });
          return;
        }
        remove(cur.uid);
        toast({ title: 'Страница удалена' });
        return;
      }

      if (typing) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoom(zoomIn);
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom(zoomOut);
        } else if (e.key === '0') {
          e.preventDefault();
          setZoom(1.2);
        } else if (e.key === '1') {
          e.preventDefault();
          setFit('width');
        } else if (e.key === '2') {
          e.preventDefault();
          setFit('page');
        }
        return;
      }

      const box = scroller.current;

      // Стрелки прокручивают ленту плавно, PageUp и PageDown
      // перемещают ровно на страницу
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        box?.scrollBy({ top: 90, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        box?.scrollBy({ top: -90, behavior: 'smooth' });
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        // Сначала двигаем ленту, потом ставим номер: так смена номера
        // не запустит встречный перелёт, который дёргал бы прокрутку
        lastJump.current = 0;
        scrollTo(0);
        setActive(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = pages.length - 1;
        lastJump.current = last;
        if (box) {
          scrollTo(box.scrollHeight);
          // Листы в конце ещё не нарисованы, и настоящая высота ленты
          // становится известна лишь после перехода — доводим до низа
          window.setTimeout(() => {
            const b = scroller.current;
            if (b) b.scrollTop = b.scrollHeight;
          }, 120);
        }
        setActive(last);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, pages.length, setActive, onScreen, scrollTo]);

  // Прокрутка перетаскиванием — «рука», как в Acrobat.
  // Работает: с инструментом «Рука»; с любым инструментом, пока зажат
  // пробел; и всегда — средней кнопкой (колесом) мыши
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const handOn = tool === 'pan' || spaceHeld;

  useEffect(() => {
    if (!onScreen) return;
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing()) return;
      // Иначе пробел прокручивал бы ленту на экран вниз
      e.preventDefault();
      if (!e.repeat) setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false);
    const lost = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', lost);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', lost);
    };
  }, [onScreen]);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    let drag: { x: number; y: number; left: number; top: number; id: number } | null = null;

    const start = (e: PointerEvent) => {
      const middle = e.button === 1;
      if (!middle && !(e.button === 0 && handOn)) return;
      // Полосы прокрутки не трогаем: их тянут как обычно
      const r = box.getBoundingClientRect();
      if (e.clientX - r.left > box.clientWidth || e.clientY - r.top > box.clientHeight) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop, id: e.pointerId };
      setPanning(true);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      box.scrollLeft = drag.left - (e.clientX - drag.x);
      box.scrollTop = drag.top - (e.clientY - drag.y);
    };
    const stop = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      setPanning(false);
    };
    // Средняя кнопка в браузере включает автопрокрутку — гасим её.
    // В режиме руки щелчок и нажатие не доходят до листа: иначе рука
    // ставила бы надписи, выделяла текст или рисовала рамку
    const noAuto = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && handOn)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const noClick = (e: MouseEvent) => {
      if (handOn) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    box.addEventListener('pointerdown', start, { capture: true });
    // Движение и отпускание слушаем на всём окне: лист тянется, даже
    // если мышь в запале вышла за край ленты
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    box.addEventListener('mousedown', noAuto, { capture: true });
    box.addEventListener('click', noClick, { capture: true });
    box.addEventListener('auxclick', noAuto, { capture: true });
    return () => {
      box.removeEventListener('pointerdown', start, { capture: true });
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      box.removeEventListener('mousedown', noAuto, { capture: true });
      box.removeEventListener('click', noClick, { capture: true });
      box.removeEventListener('auxclick', noAuto, { capture: true });
    };
  }, [handOn]);

  // Колесо мыши с Ctrl меняет масштаб. Обычная прокрутка идёт
  // непрерывно через все листы, как в привычных читалках PDF
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // Увеличиваем к месту под курсором, как в Acrobat
      const r = box.getBoundingClientRect();
      anchor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      setZoom((z) =>
        e.deltaY > 0 ? zoomOut(z) : zoomIn(z),
      );
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  // Номер страницы обновляется по ходу прокрутки: показываем тот лист,
  // который занимает середину окна
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    let frame = 0;
    const onScroll = () => {
      if (frame || jumping.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const middle = box.scrollTop + box.clientHeight / 2;
        const sheets = box.querySelectorAll('[data-sheet]');
        let at = 0;
        for (let i = 0; i < sheets.length; i++) {
          const el = sheets[i] as HTMLElement;
          if (el.offsetTop <= middle) at = i;
          else break;
        }
        // Номер сменился оттого, что человек крутит колесо. Лента уже
        // там, где нужно, — подводить её ещё раз нельзя: встречный
        // плавный перелёт цеплялся бы за прокрутку и дёргал её
        lastJump.current = at;
        setActive((cur: number) => (cur === at ? cur : at));
      });
    };

    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [setActive, pages.length]);

  // Когда страницу выбирают в левой панели, лента подъезжает к ней.
  // Если же номер сменился от прокрутки колесом, lastJump уже равен
  // новому — и мы ничего не двигаем, не мешая человеку крутить
  useEffect(() => {
    if (lastJump.current === active) return;
    lastJump.current = active;
    const box = scroller.current;
    const el = box?.querySelector(`[data-sheet="${active}"]`) as HTMLElement | null;
    if (!box || !el) return;
    // Если лист и так на виду, ленту не двигаем
    const top = el.offsetTop - box.scrollTop;
    if (top > -40 && top < box.clientHeight * 0.6) return;
    scrollToPage(active);
  }, [active, scrollToPage]);

  // Слово приходит либо из поля поиска, либо из меню по правой кнопке
  const search = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q) {
      clearSearch();
      return;
    }
    setBusy(true);
    const list: number[] = [];
    const all: { page: number; k: number; n: number }[] = [];
    for (let i = 0; i < pages.length; i++) {
      const doc = docOf(pages[i]);
      if (!doc) continue;
      const n = countIn(await pageText(doc, pages[i].src), q);
      if (!n) continue;
      list.push(i);
      for (let k = 0; k < n; k++) all.push({ page: i, k, n });
    }
    setHits(list);
    setMatches(all);
    setFound(list.length ? q : '');
    setBusy(false);
    if (all.length) {
      // Начинаем с первого совпадения на текущей странице или дальше —
      // так поиск не отбрасывает человека в начало документа
      const from = all.findIndex((m) => m.page >= active);
      const at = from < 0 ? 0 : from;
      setCur(at);
      setJumpSeq((v) => v + 1);
      setActive(all[at].page);
      if (all[at].page !== active) scrollToPage(all[at].page);
    }
  };

  // Запрос из меню по правой кнопке: слово попадает в поле поиска,
  // чтобы его было видно и можно было поправить
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(
    () =>
      onSearchRequest((text) => {
        if (!onScreen || !text) return;
        setQuery(text);
        void searchRef.current(text);
      }),
    [onScreen],
  );

  // Переход к следующей или предыдущей найденной странице
  const jumpHit = (dir: number) => {
    if (!matches.length) return;
    // Человек сам перелистал на другую страницу — продолжаем оттуда
    let next: number;
    if (matches[cur]?.page === active) {
      next = (cur + dir + matches.length) % matches.length;
    } else if (dir > 0) {
      const i = matches.findIndex((m) => m.page > active);
      next = i < 0 ? 0 : i;
    } else {
      let i = -1;
      for (let j = matches.length - 1; j >= 0; j--)
        if (matches[j].page < active) {
          i = j;
          break;
        }
      next = i < 0 ? matches.length - 1 : i;
    }
    const m = matches[next];
    setCur(next);
    setJumpSeq((v) => v + 1);
    if (m.page !== active) {
      setActive(m.page);
      scrollToPage(m.page);
    }
  };
  jumpRef.current = jumpHit;

  const place = useCallback(
    (target: typeof pages[number], x: number, y: number) => {
      if (tool === 'text') {
        const text = window.prompt('Текст надписи');
        if (!text) return;
        addAnnot({ pageUid: target.uid, x, y, text, size: 14, color: '#14181C', kind: 'text' });
      }
    },
    [tool, addAnnot],
  );

  // Нарисованная фигура. Цвет берём тот же, что выбран на панели,
  // но для фигур по умолчанию красный: им указывают, а не прячут
  const shape = useCallback(
    (
      target: typeof pages[number],
      x: number,
      y: number,
      w: number,
      h: number,
      kind: 'arrow' | 'line' | 'rect' | 'oval',
      dir: { flipX: boolean; flipY: boolean },
    ) => {
      addAnnot({
        pageUid: target.uid,
        x,
        y,
        w,
        h,
        text: '',
        size: 14,
        color: PEN.line,
        kind,
        flipX: dir.flipX,
        flipY: dir.flipY,
      });
    },
    [addAnnot],
  );

  // Закраска области, обведённой мышью: закрывает всё внутри рамки —
  // и текст, и печати, и подписи на скане
  const cover = useCallback(
    (target: typeof pages[number], x: number, y: number, w: number, h: number) => {
      addAnnot({
        pageUid: target.uid,
        x,
        y,
        w,
        h,
        text: '',
        size: 14,
        color: fill,
        kind: 'block',
      });
    },
    [addAnnot, fill],
  );

  // Действия меню по правой кнопке. Работают с той страницей,
  // на которой человек щёлкнул, — она же считается текущей
  const menuFor = (target: typeof pages[number]) => ({
    // Закрываем выделенное сплошной заливкой — тем цветом,
    // что выбран на панели. По умолчанию чёрный: так принято
    // в документах, где сведения скрывают перед передачей
    onHideText: (spans: { x: number; y: number; w: number; h: number }[]) => {
      spans.forEach((s) =>
        addAnnot({
          pageUid: target.uid,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          text: '',
          size: 14,
          color: fill,
          kind: 'block',
        }),
      );
      window.getSelection()?.removeAllRanges();
      toast({ title: 'Текст замазан' });
    },

    // «Удалить текст» закрывает его цветом листа — белым. Внешне слова
    // исчезают, а сам файл остаётся с той же разметкой
    onEraseText: (spans: { x: number; y: number; w: number; h: number }[]) => {
      spans.forEach((s) =>
        addAnnot({
          pageUid: target.uid,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          text: '',
          size: 14,
          color: '#FFFFFF',
          kind: 'block',
        }),
      );
      window.getSelection()?.removeAllRanges();
      toast({ title: 'Текст удалён' });
    },

    onSelectText: () => {
      setTool('hand');
      toast({
        title: 'Выделяйте текст мышью',
        description: 'Проведите по нужным словам, удерживая левую кнопку',
      });
    },

    // Маркер, подчёркивание и зачёркивание ложатся ровно по выделенным
    // словам. Текст под ними остаётся читаемым и доступным для поиска
    onMarkText: (
      spans: { x: number; y: number; w: number; h: number }[],
      kind: 'mark' | 'under' | 'strike',
    ) => {
      const color = kind === 'mark' ? PEN.mark : PEN.line;
      spans.forEach((s) =>
        addAnnot({
          pageUid: target.uid,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          text: '',
          size: 14,
          color,
          kind,
        }),
      );
      const NAME = { mark: 'Выделено маркером', under: 'Подчёркнуто', strike: 'Зачёркнуто' };
      toast({ title: NAME[kind] });
      window.getSelection()?.removeAllRanges();
    },

    onCoverArea: () => {
      setTool('block');
      toast({
        title: 'Закрашивание области',
        description: 'Обведите мышью то, что нужно закрыть',
      });
    },

    onPaste: async () => {
      const text = await navigator.clipboard.readText().catch(() => '');
      if (!text.trim()) {
        toast({ title: 'В буфере обмена нет текста' });
        return;
      }
      // Вставляем надписью в середину листа: перетащить её потом
      // проще, чем угадывать место заранее
      addAnnot({
        pageUid: target.uid,
        x: 0.1,
        y: 0.1,
        text: text.slice(0, 200),
        size: 14,
        color: '#14181C',
        kind: 'text',
      });
      toast({ title: 'Текст вставлен' });
    },

    onDeletePage: () => {
      if (pages.length < 2) {
        toast({ title: 'Это единственная страница', description: 'Удалить её нельзя' });
        return;
      }
      remove(target.uid);
      toast({ title: 'Страница удалена' });
    },

    onRotate: (dir: number) => rotate(target.uid, dir),

    onEditDoc: () => {
      setTool('text');
      toast({
        title: 'Правка документа',
        description: 'Щёлкните по странице, чтобы добавить надпись',
      });
    },

    onPrint: () => {
      setActive(pages.indexOf(target));
      requestPrint({ scope: 'current' });
    },

    // Экспорт одной страницы: отдельный файл PDF только с ней
    onExport: async () => {
      setBusy(true);
      try {
        const bytes = await buildPdf([target]);
        const base = (name || 'document').replace(/\.pdf$/i, '');
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${base}-стр-${pages.indexOf(target) + 1}.pdf`);
      } catch {
        toast({ title: 'Не удалось сохранить страницу', description: 'Попробуйте ещё раз' });
      } finally {
        setBusy(false);
      }
    },

    // Экспорт одной страницы картинкой JPEG. Берём страницу так, как она
    // выглядит в документе: с поворотом, надписями и пометками.
    // Плотность 200 точек на дюйм — чётко и для печати, и для отправки
    onExportJpeg: async () => {
      setBusy(true);
      try {
        const bytes = await buildPdf([target]);
        downloadBlob(await pageToJpeg(bytes), jpegName(name, pages.indexOf(target) + 1));
      } catch {
        toast({ title: 'Не удалось сохранить картинку', description: 'Попробуйте ещё раз' });
      } finally {
        setBusy(false);
      }
    },

    onSavePdf: async () => {
      setBusy(true);
      try {
        const bytes = await buildPdf();
        // Сохраняем сам документ: если в окне Windows зададут другое
        // название, документ должен дальше жить под ним
        expectRename(renameDoc);
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name || 'document.pdf');
      } finally {
        setBusy(false);
      }
    },

    onPageSetup: () => requestPrint({ tab: 'paper' }),
  });

  if (!page) return null;

  const toolBtn = (id: Tool, icon: string, title: string) => (
    <button
      className={`px-3 py-2 transition-colors ${tool === id ? 'bg-primary text-primary-foreground' : 'hover:bg-card'}`}
      onClick={() => setTool(id)}
      title={title}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {cleaning && <CleanScanDialog onClose={() => setCleaning(false)} />}
      {/* На телефоне панель переносилась на три строки и съедала экран.
          Теперь она в одну строку и прокручивается пальцем вбок */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-2 py-2 md:flex-wrap md:gap-2 md:overflow-visible md:px-4">
        <div className="flex shrink-0 items-center border border-border bg-background">
          <button
            className="px-3 py-2 hover:bg-card disabled:opacity-30"
            onClick={() => go(-1)}
            disabled={active === 0}
            title="Предыдущая страница (PageUp)"
          >
            <Icon name="ChevronLeft" size={16} />
          </button>
          <span className="px-3 font-head text-[0.82rem] font-bold">
            {active + 1} / {pages.length}
          </span>
          <button
            className="px-3 py-2 hover:bg-card disabled:opacity-30"
            onClick={() => go(1)}
            disabled={active === pages.length - 1}
            title="Следующая страница (PageDown)"
          >
            <Icon name="ChevronRight" size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center border border-border bg-background">
          <button
            className="px-3 py-2 hover:bg-card"
            onClick={() => setZoom(zoomOut)}
            title="Уменьшить (Ctrl и колесо мыши)"
          >
            <Icon name="Minus" size={16} />
          </button>
          <div className="relative">
            <button
              className="px-2 py-2 font-head text-[0.82rem] font-bold hover:bg-card"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setZoomList((v) => !v)}
              title="Выбрать масштаб"
            >
              {Math.round(zoom * 100)}%
            </button>

            {zoomList && (
              <div
                className="absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 border border-border bg-background shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {ZOOM_STEPS.map((v) => (
                  <button
                    key={v}
                    className={`block w-full px-4 py-1.5 text-right font-head text-[0.78rem] transition-colors hover:bg-card ${
                      Math.round(zoom * 100) === Math.round(v * 100)
                        ? 'bg-primary text-primary-foreground'
                        : ''
                    }`}
                    onClick={() => {
                      setZoom(v);
                      setZoomList(false);
                    }}
                  >
                    {Math.round(v * 100)}%
                  </button>
                ))}
                <button
                  className="block w-full border-t border-border px-4 py-1.5 text-right font-head text-[0.78rem] transition-colors hover:bg-card"
                  onClick={() => {
                    setFit('page');
                    setZoomList(false);
                  }}
                >
                  Целиком
                </button>
              </div>
            )}
          </div>
          <button
            className="px-3 py-2 hover:bg-card"
            onClick={() => setZoom(zoomIn)}
            title="Увеличить (Ctrl и колесо мыши)"
          >
            <Icon name="Plus" size={16} />
          </button>
          <button
            className={`border-l border-border px-3 py-2 transition-colors ${
              fit === 'width' ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
            }`}
            onClick={() => setFit(fit === 'width' ? 'none' : 'width')}
            title="По ширине окна (Ctrl и 1)"
          >
            <Icon name="MoveHorizontal" size={16} />
          </button>
          <button
            className={`px-3 py-2 transition-colors ${
              fit === 'page' ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
            }`}
            onClick={() => setFit(fit === 'page' ? 'none' : 'page')}
            title="Страница целиком (Ctrl и 2)"
          >
            <Icon name="Maximize2" size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center border border-border bg-background">
          <button className="px-3 py-2 hover:bg-card" onClick={() => rotate(page.uid, -90)} title="Повернуть влево">
            <Icon name="RotateCcw" size={16} />
          </button>
          <button className="px-3 py-2 hover:bg-card" onClick={() => rotate(page.uid, 90)} title="Повернуть вправо">
            <Icon name="RotateCw" size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center border border-border bg-background">
          <button
            className={`px-3 py-2 transition-colors ${spread ? 'bg-primary text-primary-foreground' : 'hover:bg-card'}`}
            onClick={toggleSpread}
            title={spread ? 'Показывать по одной странице' : 'Две страницы рядом, как разворот книги'}
          >
            <Icon name={spread ? 'BookOpen' : 'File'} size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center border border-border bg-background">
          {toolBtn('hand', 'MousePointer2', 'Выделение текста')}
          {toolBtn('pan', 'Hand', 'Рука: двигайте лист мышью (или держите пробел)')}
          {toolBtn('text', 'Type', 'Добавить надпись')}
          {toolBtn('block', 'Square', 'Закрасить данные: обведите область мышью')}
          {toolBtn('note', 'MessageSquarePlus', 'Заметка: щёлкните по странице')}
          {toolBtn('arrow', 'ArrowUpRight', 'Стрелка: протяните мышью')}
          {toolBtn('line', 'Minus', 'Линия: протяните мышью')}
          {toolBtn('rect', 'RectangleHorizontal', 'Рамка: обведите мышью')}
          {toolBtn('oval', 'Circle', 'Овал: обведите мышью')}
          {toolBtn('stamp', 'Stamp', 'Штамп: Alt+щелчок — взять чистое место, затем закрашивайте помарку')}
        </div>

        <div className="flex shrink-0 items-center border border-border bg-background">
          <button
            className="flex items-center gap-1.5 px-3 py-2 text-[0.8rem] hover:bg-card"
            onClick={() => pictureInput.current?.click()}
            title="Вставить картинку PNG или JPEG — подпись, печать, логотип. Также Ctrl+V из буфера обмена"
          >
            <Icon name="ImagePlus" size={16} />
            <span className="hidden lg:inline">Картинка</span>
          </button>
          <div className="h-5 w-px bg-border" />
          <SignaturesMenu
            onPick={pickSignature}
            onAddFile={() => {
              saveNextPicture.current = true;
              pictureInput.current?.click();
            }}
          />
          <input
            ref={pictureInput}
            type="file"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void insertPicture(f);
              else saveNextPicture.current = false;
            }}
          />
        </div>

        <div className="flex shrink-0 items-center border border-border bg-background">
          <button
            className="flex items-center gap-1.5 px-3 py-2 text-[0.8rem] hover:bg-card"
            onClick={() => setCleaning(true)}
            title="Очистить фон скана: убрать серый оттенок, тени и мелкие точки"
          >
            <Icon name="Sparkles" size={16} />
            <span className="hidden lg:inline">Очистить фон</span>
          </button>
        </div>

        {/* Настройки штампа: размер и мягкость кисти, выбор источника */}
        {tool === 'stamp' && (
          <div className="flex shrink-0 items-center gap-2 border border-border bg-background px-2 py-1">
            {/* Режим: копия как есть или с подгонкой под фон */}
            <div className="flex border border-border">
              <button
                onClick={() => setStampHeal(false)}
                title="Штамп: переносит кусок листа как есть"
                className={`flex items-center gap-1 px-2 py-1 text-[0.74rem] transition-colors ${
                  !stampHeal ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
                }`}
              >
                <Icon name="Stamp" size={13} />
                Копия
              </button>
              <button
                onClick={() => setStampHeal(true)}
                title="Восстановление: берёт фактуру из источника, а цвет и яркость подгоняет под фон вокруг помарки"
                className={`flex items-center gap-1 border-l border-border px-2 py-1 text-[0.74rem] transition-colors ${
                  stampHeal ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
                }`}
              >
                <Icon name="Bandage" fallback="Sparkles" size={13} />
                Восстановление
              </button>
            </div>

            <button
              onClick={() => setStampChoosing((v) => !v)}
              title="Источник: нажмите и щёлкните по чистому месту листа (или Alt+щелчок)"
              className={`flex items-center gap-1 px-2 py-1 text-[0.76rem] transition-colors ${
                stampChoosing ? 'bg-primary text-primary-foreground' : stampSource ? 'hover:bg-card' : 'text-primary hover:bg-card'
              }`}
            >
              <Icon name="Crosshair" size={14} />
              {stampSource ? 'Источник' : 'Выбрать источник'}
            </button>

            <button
              onClick={() => setStampSize((v) => v - (v < 20 ? 2 : v < 60 ? 5 : 10))}
              title="Меньше (клавиша [)"
              className="px-1 py-1 hover:bg-card"
            >
              <Icon name="Minus" size={14} />
            </button>
            <input
              type="range"
              min={STAMP_MIN}
              max={STAMP_MAX}
              value={stampSize}
              onChange={(e) => setStampSize(Number(e.target.value))}
              title="Размер кисти"
              className="w-24 accent-primary"
            />
            <button
              onClick={() => setStampSize((v) => v + (v < 20 ? 2 : v < 60 ? 5 : 10))}
              title="Больше (клавиша ])"
              className="px-1 py-1 hover:bg-card"
            >
              <Icon name="Plus" size={14} />
            </button>
            <span className="w-10 text-right font-head text-[0.74rem] font-bold">{stampSize}</span>

            <label className="flex items-center gap-1 text-[0.74rem] text-muted-foreground" title="Мягкость края кисти">
              Край
              <input
                type="range"
                min={0}
                max={100}
                value={stampSoft}
                onChange={(e) => setStampSoft(Number(e.target.value))}
                className="w-16 accent-primary"
              />
            </label>
          </div>
        )}

        {/* Цвет заливки: виден, только когда выбрано закрашивание */}
        {tool === 'block' && (
          <div className="flex items-center gap-1 border border-border bg-background px-1">
            {FILLS.map((c) => (
              <button
                key={c.value}
                onClick={() => {
                  setPicking(false);
                  setFill(c.value);
                }}
                title={c.title}
                className={`h-6 w-6 border transition-transform ${
                  fill.toUpperCase() === c.value && !picking
                    ? 'border-primary ring-2 ring-primary'
                    : 'border-border hover:scale-110'
                }`}
                style={{ background: c.value }}
              />
            ))}

            <button
              onClick={() => setPicking((v) => !v)}
              title="Взять цвет с листа: нажмите, затем щёлкните по нужному месту"
              className={`px-2 py-1.5 transition-colors ${
                picking ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
              }`}
            >
              <Icon name="Pipette" size={15} />
            </button>

            {/* Свой цвет из палитры Windows */}
            <label
              title="Свой цвет"
              className="flex cursor-pointer items-center px-1 py-1.5 hover:bg-card"
            >
              <Icon name="Palette" size={15} />
              <input
                type="color"
                value={fill}
                onChange={(e) => {
                  setPicking(false);
                  setFill(e.target.value.toUpperCase());
                }}
                className="h-0 w-0 opacity-0"
              />
            </label>
          </div>
        )}

        <div className="ml-auto flex items-center border border-border bg-background">
          <input
            ref={searchBox}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Повторный Enter по тому же запросу — к следующему совпадению,
              // как в браузере и Word. Shift+Enter — к предыдущему
              if (matches.length && query.trim() === found) jumpHit(e.shiftKey ? -1 : 1);
              else void search();
            }}
            placeholder="Поиск (Ctrl+F)"
            className="w-[120px] bg-transparent px-2 py-2 text-[0.86rem] outline-none md:w-[180px] md:px-3"
          />
          {matches.length > 0 && query.trim() === found && (
            <span
              className="whitespace-nowrap px-1 font-head text-[0.74rem] font-bold tabular-nums text-muted-foreground"
              title="Номер текущего совпадения и сколько всего найдено"
            >
              {cur + 1} из {matches.length}
            </span>
          )}
          <button
            className="px-3 py-2 text-primary hover:bg-card"
            onClick={() => void search()}
            title="Найти (Enter), следующее совпадение — F3"
          >
            <Icon name="Search" size={16} />
          </button>
        </div>
      </div>

      {hits && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2 text-[0.8rem] text-muted-foreground">
          {hits.length ? (
            <>
              <Icon name="Search" size={14} className="text-primary" />
              <span>
                Совпадение <b className="text-foreground">{cur + 1}</b> из {matches.length}
                {hits.length > 1 ? ` · на ${hits.length} стр.` : ''} — текущее выделено оранжевым
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => jumpHit(-1)}
                  className="border border-border px-2 py-1 hover:border-foreground"
                  title="Предыдущее совпадение (Shift+F3)"
                >
                  <Icon name="ChevronUp" size={13} />
                </button>
                <button
                  onClick={() => jumpHit(1)}
                  className="border border-border px-2 py-1 hover:border-foreground"
                  title="Следующее совпадение (F3)"
                >
                  <Icon name="ChevronDown" size={13} />
                </button>
                <button
                  onClick={() => {
                    clearSearch();
                    setQuery('');
                  }}
                  className="border border-border px-2 py-1 hover:border-destructive hover:text-destructive"
                  title="Сбросить поиск (Esc)"
                >
                  <Icon name="X" size={13} />
                </button>
              </div>
            </>
          ) : (
            'Совпадений не найдено'
          )}
        </div>
      )}

      <div
        ref={scroller}
        data-scroller
        className={`relative flex-1 overflow-auto overscroll-contain bg-desk ${
          panning ? 'pvs-grabbing' : handOn ? 'pvs-grab' : ''
        }`}
        style={{ scrollBehavior: 'auto' }}
      >
        {busy && (
          <div className="absolute right-6 top-6 z-20 flex items-center gap-2 border border-border bg-background px-3 py-2 text-[0.8rem]">
            <Icon name="LoaderCircle" size={14} className="animate-spin text-primary" />
            Обработка
          </div>
        )}
        {/* Непрерывная лента: все листы идут один за другим,
            прокрутка не прерывается на границах страниц */}
        {/* Ширина ленты — по самому широкому листу, но не меньше окна.
            Раньше лента была шириной с окно, а листы центрировались
            внутри неё: увеличенный лист вылезал за левый край, куда
            прокрутка не достаёт, и полосы прокрутки были короче документа */}
        <div className="flex w-max min-w-full flex-col items-center p-6">
          {rows.map((row) => (
            <div key={row[0].p.uid} className="flex w-max items-start justify-center gap-4">
              {row.map(({ p, i }) => (
                <SheetView
                  key={p.uid}
                  page={p}
                  index={i}
                  zoom={zoom}
                  doc={docOf(p)}
                  tool={tool}
                  marks={annots.filter((a) => a.pageUid === p.uid)}
                  found={found}
                  current={
                    matches[cur]?.page === i ? { k: matches[cur].k, n: matches[cur].n, seq: jumpSeq } : null
                  }
                  hint={hint}
                  onPlace={place}
                  onCover={cover}
                  fill={tool === 'block' ? fill : PEN.line}
                  notes={notes
                    .filter((n) => n.page === pages.indexOf(p))
                    .map((n) => ({ id: n.id, x: n.x, y: n.y, done: n.done, author: n.author }))}
                  onNote={addNote}
                  onShape={shape}
                  stamp={tool === 'stamp' ? stamp : undefined}
                  onPatch={patch}
                  selectedImage={selectedImage}
                  onSelectImage={setSelectedImage}
                  onMoveImage={moveImage}
                  onClearImageBg={(id) => void clearImageBg(id)}
                  onSaveImage={(id) => void rememberImage(id)}
                  onOpenNote={() => openNotes()}
                  picking={picking}
                  onPick={(c) => {
                    setFill(c);
                    setPicking(false);
                    toast({ title: 'Цвет взят с листа', description: c });
                  }}
                  onRemoveMark={removeAnnot}
                  menuActions={menuFor(p)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Viewer;