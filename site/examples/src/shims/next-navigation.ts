// Stand-in for next/navigation in the v0 templates: every example is the home route.
export const usePathname = () => '/';
export const useRouter = () => ({ push() {}, replace() {}, back() {}, refresh() {}, prefetch() {} });
export const useSearchParams = () => new URLSearchParams(location.search);
