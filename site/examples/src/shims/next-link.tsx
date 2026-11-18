// Stand-in for next/link in the v0 templates: a plain <a>. Routes of the original
// multi-page app ("/tasks") stay on this page, since only one page of each template is here.
import type { AnchorHTMLAttributes } from 'react';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string | { pathname?: string } };

export default function Link({ href, ...rest }: Props) {
  const url = typeof href === 'string' ? href : (href.pathname ?? '#');
  return <a href={url.startsWith('/') ? '#' : url} {...rest} />;
}
