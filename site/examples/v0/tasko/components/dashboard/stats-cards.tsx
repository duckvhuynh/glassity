"use client"

import { ArrowUpRight, TrendingUp } from "lucide-react"
import { Card } from "@/components/ui/card"
import { useState } from "react"
import { GlassProvider } from "glassity/react"

const stats = [
  {
    title: "Total Projects",
    value: "24",
    increase: "Increased from last month",
    bgColor: "bg-primary",
    textColor: "text-primary-foreground",
    delay: "0ms",
  },
  {
    title: "Ended Projects",
    value: "10",
    increase: "Increased from last month",
    bgColor: "bg-card",
    textColor: "text-foreground",
    delay: "100ms",
  },
  {
    title: "Running Projects",
    value: "12",
    increase: "Increased from last month",
    bgColor: "bg-card",
    textColor: "text-foreground",
    delay: "200ms",
  },
  {
    title: "Pending Project",
    value: "2",
    subtitle: "On Discuss",
    bgColor: "bg-card",
    textColor: "text-foreground",
    delay: "300ms",
  },
]

export function StatsCards() {
  const [hoveredCard, setHoveredCard] = useState<number | null>(null)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, index) => (
        <Card
          key={stat.title}
          onMouseEnter={() => setHoveredCard(index)}
          onMouseLeave={() => setHoveredCard(null)}
          style={{ animationDelay: stat.delay }}
          className={`${stat.bgColor} ${stat.textColor} p-4 transition-all duration-500 ease-out animate-slide-in-up cursor-pointer ${
            hoveredCard === index ? "scale-105 shadow-2xl" : "shadow-lg"
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-xs font-medium opacity-90">{stat.title}</h3>
            {/* glassity: a round glass button in place of the solid chip */}
            <GlassProvider
              tile tileRadius={0.5} profile="circle" bevel={0.5} depth={0.3} weight={0.02}
              className={`rounded-full transition-transform duration-300 ${stat.bgColor === "bg-primary" ? "" : "bg-primary"} ${hoveredCard === index ? "rotate-45" : ""}`}
            >
              <ArrowUpRight data-glass size={30} color="#fff" aria-hidden />
            </GlassProvider>
          </div>
          <p className="text-3xl font-bold mb-2">{stat.value}</p>
          <div className="flex items-center gap-1.5 text-xs opacity-80">
            {stat.increase && (
              <>
                <TrendingUp className="w-3 h-3" />
                <span>{stat.increase}</span>
              </>
            )}
            {stat.subtitle && <span>{stat.subtitle}</span>}
          </div>
        </Card>
      ))}
    </div>
  )
}
