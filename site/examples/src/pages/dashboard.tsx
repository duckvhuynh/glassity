// shadcn/ui block "dashboard-01" (MIT), with a photo behind the inset layout and glass quick actions.
import type * as React from 'react';
import { BellIcon, CalendarIcon, FileTextIcon, MessageCircleIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { GlassProvider } from 'glassity/react';
import aurora from '../../../backdrops/aurora.webp';

import { AppSidebar } from '@/components/app-sidebar';
import { ChartAreaInteractive } from '@/components/chart-area-interactive';
import { DataTable } from '@/components/data-table';
import { SectionCards } from '@/components/section-cards';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import data from '@/app/dashboard/data.json';

const actions = [
  { icon: PlusIcon, label: 'New document' },
  { icon: SearchIcon, label: 'Search' },
  { icon: CalendarIcon, label: 'Calendar' },
  { icon: MessageCircleIcon, label: 'Messages' },
  { icon: BellIcon, label: 'Alerts' },
  { icon: FileTextIcon, label: 'Reports' },
];

export function Dashboard() {
  return (
    <div className="min-h-svh bg-cover bg-center" style={{ backgroundImage: `url(${aurora})` }}>
      <SidebarProvider
        className="bg-transparent"
        style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' } as React.CSSProperties}
      >
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                {/* Quick actions over the same photo: glass tiles that refract it. */}
                <div className="px-4 lg:px-6">
                  <div className="overflow-hidden rounded-xl bg-cover bg-center p-6" style={{ backgroundImage: `url(${aurora})` }}>
                    <p className="mb-4 text-sm font-medium text-white/80">Quick actions</p>
                    <GlassProvider tile interactive>
                      <div className="flex flex-wrap gap-4">
                        {actions.map(({ icon: Icon, label }) => (
                          <button key={label} type="button" aria-label={label} className="rounded-2xl">
                            <Icon data-glass size={56} strokeWidth={2.2} color="#fff" aria-hidden />
                          </button>
                        ))}
                      </div>
                    </GlassProvider>
                  </div>
                </div>
                <SectionCards />
                <div className="px-4 lg:px-6">
                  <ChartAreaInteractive />
                </div>
                <DataTable data={data} />
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
