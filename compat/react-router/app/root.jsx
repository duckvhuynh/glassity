import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

const css = `
  body { margin: 0; font: 14px system-ui, sans-serif; background: #111; color: #eee; }
  .stage { display: flex; gap: 28px; align-items: center; padding: 36px; flex-wrap: wrap;
    background: repeating-linear-gradient(90deg, #ffffff40 0 2px, transparent 2px 14px), linear-gradient(135deg, #e2572e, #2a2f7a); }
  .stage svg { width: 64px; height: 64px; }
  button { margin: 8px 4px; }
`;

export function Layout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>glassity compat: react-router</title>
        <style>{css}</style>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
