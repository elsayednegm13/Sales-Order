import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';

interface BrandMarkProps {
  logoUrl: string | null;
  companyName: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: {
    box: 'h-9 w-9 rounded-lg',
    img: 'h-9 w-9 rounded-lg',
    icon: 'h-4 w-4',
  },
  md: {
    box: 'h-11 w-11 rounded-xl',
    img: 'h-11 w-11 rounded-xl',
    icon: 'h-5 w-5',
  },
  lg: {
    box: 'h-16 w-16 rounded-2xl',
    img: 'h-16 w-16 rounded-2xl',
    icon: 'h-7 w-7',
  },
};

export function BrandMark({
  logoUrl,
  companyName,
  size = 'md',
}: BrandMarkProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const dims = SIZE_MAP[size];

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={companyName}
        onError={() => setImgFailed(true)}
        className={`${dims.img} shrink-0 border border-slate-200/80 bg-white object-contain p-1 dark:border-slate-800 dark:bg-slate-900`}
      />
    );
  }

  return (
    <div
      className={`${dims.box} shrink-0 inline-flex items-center justify-center bg-blue-600 text-white shadow-xs dark:bg-blue-500`}
      aria-hidden="true"
    >
      <Layers className={dims.icon} strokeWidth={2.1} />
    </div>
  );
}
