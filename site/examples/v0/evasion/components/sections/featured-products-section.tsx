"use client";

import { FadeImage } from "@/components/fade-image";
import { Heart, ShoppingBag } from "lucide-react";
import { GlassProvider } from "glassity/react";

const features = [
  {
    title: "Smart Temperature Control",
    description: "Innovation",
    image: "v0-evasion/d18fe616-5596-4559-90f5-a90f5397d0d8.webp",
  },
  {
    title: "Ultra-Light Carbon Frame",
    description: "Performance",
    image: "v0-evasion/e26fa9c3-966d-4966-94a4-954a1e511c1c.webp",
  },
  {
    title: "Weather-Resistant Design",
    description: "Durability",
    image: "v0-evasion/car.webp",
  },
  {
    title: "Integrated GPS Tracking",
    description: "Navigation",
    image: "v0-evasion/204cee22-9e85-49e8-9303-1d309af626b0.webp",
  },
  {
    title: "Built-In LED Flashlight",
    description: "Visibility",
    image: "v0-evasion/led-flashlight-bottle.webp",
  },
  {
    title: "Self-Heating Technology",
    description: "Comfort",
    image: "v0-evasion/heating-campfire.webp",
  },
];

export function FeaturedProductsSection() {
  return (
    <section id="technology" className="bg-background">
      {/* Section Title */}
      <div className="px-6 py-20 text-center md:px-12 md:py-28 lg:px-20 lg:py-32 lg:pb-20">
        <h2 className="text-3xl font-medium tracking-tight text-foreground md:text-4xl lg:text-5xl">
          Engineered for Excellence.
          <br />
          Designed for Adventure.
        </h2>
        <p className="mx-auto mt-6 max-w-md text-sm text-muted-foreground">
          Technology
        </p>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 gap-4 px-6 pb-20 md:grid-cols-3 md:px-12 lg:px-20">
        {features.map((feature) => (
          <div key={feature.title} className="group">
            {/* Image */}
            <GlassProvider backdrop={feature.image} tile tileRadius={0.5} profile="circle" bevel={0.5} depth={0.3} weight={0.02} className="relative aspect-[4/3] overflow-hidden rounded-2xl">
              <FadeImage
                src={feature.image || "/placeholder.svg"}
                alt={feature.title}
                fill
                className="object-cover group-hover:scale-105"
              />
              {/* glassity: round glass buttons over the photo */}
              <div className="absolute top-3 right-3 flex gap-2">
                <button type="button" aria-label="Save" className="rounded-full"><Heart data-glass size={40} color="#fff" aria-hidden /></button>
                <button type="button" aria-label="Add to bag" className="rounded-full"><ShoppingBag data-glass size={40} color="#fff" aria-hidden /></button>
              </div>
            </GlassProvider>

            {/* Content */}
            <div className="py-6">
              <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                {feature.description}
              </p>
              <h3 className="text-foreground text-xl font-semibold">
                {feature.title}
              </h3>
            </div>
          </div>
        ))}
      </div>

      {/* CTA Link */}
      <div className="flex justify-center px-6 pb-28 md:px-12 lg:px-20">
        
      </div>
    </section>
  );
}
