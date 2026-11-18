// A premium landing page: hero photo with glass feature icons, built from shadcn/ui Button and Card.
import { ArrowRightIcon, LeafIcon, ShieldCheckIcon, SparklesIcon, TruckIcon } from 'lucide-react';
import { GlassProvider } from 'glassity/react';
import meadow from '../../../backdrops/meadow.webp';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  { icon: LeafIcon, title: 'Organic', text: 'Grown on highland farms, no pesticides.' },
  { icon: TruckIcon, title: 'Same-day delivery', text: 'Across the city before 6 pm.' },
  { icon: ShieldCheckIcon, title: 'Quality checked', text: 'Every batch tested before it ships.' },
  { icon: SparklesIcon, title: 'Members save 15%', text: 'On every order, from the first one.' },
];

export function Landing() {
  return (
    <div className="min-h-svh bg-background">
      <section className="relative flex min-h-[640px] flex-col items-center justify-center gap-10 bg-cover bg-center px-6 py-20 text-center text-white" style={{ backgroundImage: `url(${meadow})` }}>
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/30" />
        <div className="relative max-w-2xl">
          <h1 className="text-5xl font-semibold tracking-tight drop-shadow md:text-6xl">Fresh from the highlands</h1>
          <p className="mt-4 text-lg opacity-90 drop-shadow">Vegetables picked this morning, at your door tonight.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Button size="lg">
              Shop now <ArrowRightIcon />
            </Button>
            <Button size="lg" variant="secondary">
              Our farms
            </Button>
          </div>
        </div>
        {/* Feature icons as glass over the hero photo. */}
        <GlassProvider weight={0.03} depth={0.22} className="relative grid w-full max-w-4xl grid-cols-2 gap-8 md:grid-cols-4">
          {features.map(({ icon: Icon, title }) => (
            <div key={title} className="flex flex-col items-center gap-3">
              <Icon data-glass size={72} color="#fff" aria-hidden />
              <span className="font-medium drop-shadow">{title}</span>
            </div>
          ))}
        </GlassProvider>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-16 md:grid-cols-2">
        {features.map(({ title, text }) => (
          <Card key={title}>
            <CardContent>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{text}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
