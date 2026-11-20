import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  unref,
  watch,
  type Directive,
  type MaybeRef,
  type PropType,
  type Ref,
} from 'vue';
import { auto, glassify, type GlassController, type GlassHandle, type GlassOptions } from './index';
import { changed, fromAttributes } from './adapter';
import { findSvg } from './dom';
import { textTarget } from './text';
import { readAttributes } from './options';

export type { GlassHandle, GlassOptions } from './index';

const handles = new WeakMap<Element, { handle: GlassHandle; options: GlassOptions }>();

/**
 * Vue directive: turn one icon into glass.
 *
 * ```vue
 * <script setup>
 * import { vGlass } from 'glassity/vue';
 * import { Calendar } from 'lucide-vue-next';
 * </script>
 *
 * <template>
 *   <Calendar v-glass="{ tile: true }" />
 * </template>
 * ```
 *
 * On a component the directive lands on its root element; an `<svg>` root or a
 * root that contains one both work.
 */
export const vGlass: Directive<Element, GlassOptions | undefined> = {
  mounted(el, binding) {
    const options = { ...binding.value };
    handles.set(el, { handle: glassify(el, options), options });
  },
  updated(el, binding) {
    const entry = handles.get(el);
    if (!entry) return;
    const next = binding.value ?? {};
    const svg = textTarget(el, next.text ?? readAttributes(el)?.text) ?? findSvg(el);
    if (svg && svg !== entry.handle.element) entry.handle.retarget(svg); // the child icon was swapped: morph
    if (!changed(entry.options, next)) return;
    entry.options = { ...next };
    entry.handle.set(next);
  },
  beforeUnmount(el) {
    handles.get(el)?.handle.destroy();
    handles.delete(el);
  },
};

/**
 * Composable: turn the element in a template ref (an `<svg>`, or one that contains
 * an `<svg>`) into glass. Options may be a ref and are watched.
 *
 * ```vue
 * const icon = ref();
 * useGlass(icon, { tile: true });
 * ```
 */
export function useGlass(target: Ref<Element | { $el: Element } | null | undefined>, options: MaybeRef<GlassOptions> = {}): void {
  let handle: GlassHandle | null = null;
  let current: GlassOptions | undefined;
  const element = () => {
    const value = target.value;
    return value && '$el' in value ? (value.$el as Element) : (value as Element | null | undefined);
  };
  onMounted(() => {
    const el = element();
    if (!el) return;
    current = { ...unref(options) };
    handle = glassify(el, current);
  });
  watch(
    () => unref(options),
    (next) => {
      if (!handle || !changed(current, next)) return;
      current = { ...next };
      handle.set(next);
    },
    { deep: true },
  );
  onBeforeUnmount(() => handle?.destroy());
}

/**
 * Turns matching icons inside it into glass, and sets shared options for them.
 * Options can be written as attributes (`tile`, `depth="0.3"`, `:interactive="on"`)
 * or passed together as `:options`. Providers nest; the inner one wins.
 *
 * ```vue
 * <GlassProvider selector="svg.lucide" tile interactive>
 *   <Toolbar />
 * </GlassProvider>
 * ```
 */
export const GlassProvider = defineComponent({
  name: 'GlassProvider',
  inheritAttrs: false,
  props: {
    /** Which elements become glass. Default `[data-glass]`. */
    selector: { type: String, default: '[data-glass]' },
    /** Element to render around the content. Default a `<div>` that does not affect layout. */
    as: { type: String, default: 'div' },
    /** Options as one object; attributes are merged under it. */
    options: { type: Object as PropType<GlassOptions>, default: undefined },
  },
  setup(props, { slots, attrs }) {
    // Attributes are not reactive in Vue; they are read again after every update.
    const fromAttrs = ref<GlassOptions>(fromAttributes(attrs));
    onUpdated(() => {
      const next = fromAttributes(attrs);
      if (changed(fromAttrs.value, next)) fromAttrs.value = next;
    });
    const merged = computed<GlassOptions>(() => ({ ...fromAttrs.value, ...props.options }));

    const root = ref<HTMLElement | null>(null);
    let controller: GlassController | null = null;
    let current: GlassOptions | undefined;
    onMounted(() => {
      if (!root.value) return;
      current = { ...merged.value };
      controller = auto({ root: root.value, selector: props.selector, ...current });
    });
    watch(merged, (next) => {
      if (!controller || !changed(current, next)) return;
      current = { ...next };
      controller.set(next);
    });
    watch(
      () => props.selector,
      (selector) => {
        if (!controller || !root.value) return;
        controller.destroy();
        controller = auto({ root: root.value, selector, ...merged.value });
      },
    );
    onBeforeUnmount(() => controller?.destroy());

    return () => {
      const { class: className, style } = attrs as { class?: unknown; style?: unknown };
      return h(props.as, { ref: root, class: className, style: style ?? { display: 'contents' } }, slots.default?.());
    };
  },
});
