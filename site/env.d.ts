declare module 'virtual:icons' {
  interface IconData {
    viewBox: string;
    attrs: Record<string, string>;
    body: string;
  }
  const icons: {
    lucide: Record<string, IconData>;
    phosphor: Record<string, IconData>;
    /** Component names in lucide-react / @phosphor-icons/react. */
    components: Record<string, { lucide: string; phosphor: string }>;
  };
  export default icons;
}
