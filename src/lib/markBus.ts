// Просьба добавить закладку на текущую страницу.
// Сочетание Ctrl+B ловит меню, а исполняет панель закладок —
// она знает, какие отметки уже стоят у этого документа

const EVENT = 'pvspdf:add-bookmark';

export const requestBookmark = () => window.dispatchEvent(new CustomEvent(EVENT));

export const onBookmarkRequest = (fn: () => void) => {
  const h = () => fn();
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
};
