// Stand-in for next/image in the v0 templates: a plain <img>.
import type { CSSProperties, ImgHTMLAttributes } from 'react';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
};

export default function Image({ src, fill, priority, quality, unoptimized, placeholder, style, ...rest }: Props) {
  void priority, quality, unoptimized, placeholder;
  const fillStyle: CSSProperties = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } : {};
  return <img src={typeof src === 'string' ? src : src.src} style={{ ...fillStyle, ...style }} {...rest} />;
}
