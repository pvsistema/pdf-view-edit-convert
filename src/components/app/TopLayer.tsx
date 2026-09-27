import { createPortal } from 'react-dom';

// Подъём окна поверх всей программы.
//
// Верхняя панель с меню «прилипающая», а такая панель запирает внутри себя
// всё, что в ней нарисовано: окно, открытое из меню, не могло подняться
// выше самой панели и пряталось под рамкой программы и под документом.
// Здесь окно переносится в самый верх страницы, где ему ничего не мешает.
const TopLayer = ({ children }: { children: React.ReactNode }) => {
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
};

export default TopLayer;
