import React from 'react';
import type { LucideProps } from 'lucide-react';
import { icons } from './icons';

interface IconProps extends LucideProps {
  name: string;
  fallback?: string;
}

// Берём иконки из готового набора: в сборку попадают только те,
// что реально используются, а не вся библиотека целиком
const Icon: React.FC<IconProps> = ({ name, fallback = 'CircleHelp', ...props }) => {
  const IconComponent = icons[name] || icons[fallback];

  if (!IconComponent) {
    return <span className="text-xs text-muted-foreground">[icon]</span>;
  }

  return <IconComponent {...props} />;
};

export default Icon;