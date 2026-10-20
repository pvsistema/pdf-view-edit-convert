namespace PvsPdfLinux;

// Скрипты, которые попадают в страницу раньше интерфейса.
//
// 1. Мост. Интерфейс общается с программой так же, как в Windows:
//    window.chrome.webview.postMessage(...) и событие 'message'.
//    В Linux у встроенного браузера другой канал (window.external) —
//    мост переводит одно в другое, и интерфейс менять не нужно.
//
// 2. Подпорки. На Astra Linux 1.7 и других стабильных выпусках стоит
//    не самый свежий WebKit, в нём нет пары новых функций, которыми
//    пользуется просмотрщик PDF. Подпорки их добавляют, если их нет
internal static class Polyfills
{
    public const string Script = """
(function () {
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (a, b) { resolve = a; reject = b; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true, writable: true,
      value: function (n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; }
    });
  }
  if (!Object.hasOwn) {
    Object.hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  }
  if (!Array.prototype.findLast) {
    Object.defineProperty(Array.prototype, 'findLast', {
      configurable: true, writable: true,
      value: function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; }
    });
  }
  if (typeof self.structuredClone !== 'function') {
    self.structuredClone = function (v) {
      return v === undefined ? v : JSON.parse(JSON.stringify(v));
    };
  }
})();
(function () {
  if (typeof window === 'undefined' || !window.external || !window.external.sendMessage) return;
  if (window.chrome && window.chrome.webview) return;
  var listeners = [];
  window.external.receiveMessage(function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return; }
    // Служебное: список принтеров приходит из программы в фоне
    if (data && data.type === '__printers') {
      window.PVSPDF_PRINTERS = data.list || [];
      window.dispatchEvent(new CustomEvent('pvspdf-printers'));
      return;
    }
    var ev = { data: data, type: 'message' };
    listeners.slice().forEach(function (cb) { try { cb(ev); } catch (e) {} });
  });
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage: function (m) {
      window.external.sendMessage(typeof m === 'string' ? m : JSON.stringify(m));
    },
    addEventListener: function (t, cb) { if (t === 'message') listeners.push(cb); },
    removeEventListener: function (t, cb) {
      if (t !== 'message') return;
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
  // Внешние ссылки (оплата, загрузка) открываем в системном браузере —
  // как это делает Windows-версия. Встроенный браузер Linux новых окон
  // сам не открывает
  var nativeOpen = window.open;
  window.open = function (url, target, features) {
    var href = '';
    try { href = new URL(String(url || ''), location.href).href; } catch (e) {}
    if (/^https?:/i.test(href) && href.indexOf(location.origin + '/') !== 0) {
      window.chrome.webview.postMessage({ type: 'openExternal', url: href });
      return { closed: false, close: function () {}, focus: function () {} };
    }
    return nativeOpen ? nativeOpen.call(window, url, target, features) : null;
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.href || '';
    if (/^https?:/i.test(href) && href.indexOf(location.origin + '/') !== 0) {
      e.preventDefault();
      window.chrome.webview.postMessage({ type: 'openExternal', url: href });
    }
  }, true);
  window.PVSPDF_LINUX = true;

  // Сообщаем программе, что интерфейс готов принимать документы:
  // так файл, с которым программу запустили, не потеряется
  window.addEventListener('load', function () {
    setTimeout(function () { window.chrome.webview.postMessage({ type: '__ready' }); }, 400);
  });
})();
""";
}