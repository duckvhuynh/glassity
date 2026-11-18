// A mobile app screen (hybrid or PWA): photo feed, glass tab bar and a round glass action button.
import { CameraIcon, HeartIcon, HouseIcon, MapPinIcon, PlusIcon, SearchIcon, UserIcon } from 'lucide-react';
import { GlassProvider } from 'glassity/react';
import meadow from '../../../backdrops/meadow.webp';
import ocean from '../../../backdrops/ocean.webp';
import leaves from '../../../backdrops/leaves.webp';

const posts = [
  { photo: meadow, place: 'Đà Lạt', likes: 1204 },
  { photo: ocean, place: 'Phú Quốc', likes: 892 },
  { photo: leaves, place: 'Sa Pa', likes: 431 },
];

export function Mobile() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-neutral-100 p-6 dark:bg-neutral-900">
      <div className="relative h-[780px] w-[380px] overflow-hidden rounded-[48px] border-8 border-neutral-900 bg-black shadow-2xl">
        <div className="h-full overflow-y-auto pb-28">
          <header className="flex items-center justify-between px-5 pt-12 pb-3 text-white">
            <span className="text-xl font-semibold">Explore</span>
            <MapPinIcon className="size-5 opacity-80" />
          </header>
          {posts.map((post) => (
            <article key={post.place} className="relative mx-3 mb-3 h-72 overflow-hidden rounded-3xl bg-cover bg-center" style={{ backgroundImage: `url(${post.photo})` }}>
              <div className="absolute bottom-3 left-4 text-white drop-shadow">
                <div className="text-lg font-semibold">{post.place}</div>
                <div className="text-sm opacity-90">{post.likes.toLocaleString('en-US')} likes</div>
              </div>
              {/* Round glass buttons over the photo. */}
              <GlassProvider tile tileRadius={0.5} profile="circle" bevel={0.5} depth={0.3} weight={0.02} className="absolute top-3 right-3 flex gap-2">
                <button type="button" aria-label="Like" className="rounded-full">
                  <HeartIcon data-glass size={44} color="#fff" aria-hidden />
                </button>
                <button type="button" aria-label="Save photo" className="rounded-full">
                  <CameraIcon data-glass size={44} color="#fff" aria-hidden />
                </button>
              </GlassProvider>
            </article>
          ))}
        </div>
        {/* A soft shade under the tab bar, as native apps have, so the feed fades out behind it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-36 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        {/* Tab bar floating over the feed: the glass bends the photos scrolling under it. */}
        <GlassProvider weight={0.03} className="absolute inset-x-4 bottom-6 z-10 flex items-center justify-around px-2 py-2">
          {[HouseIcon, SearchIcon, PlusIcon, HeartIcon, UserIcon].map((Icon, i) => (
            <button key={i} type="button" aria-label={['Home', 'Search', 'New post', 'Likes', 'Profile'][i]} className="p-1">
              <Icon data-glass size={44} color="#fff" aria-hidden />
            </button>
          ))}
        </GlassProvider>
      </div>
    </div>
  );
}
