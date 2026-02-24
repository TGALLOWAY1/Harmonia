"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  href: string;
};

type MilestoneDto = {
  key: string;
  title: string;
};

/**
 * Get breadcrumb items based on current pathname
 */
function getBreadcrumbs(pathname: string, dynamicLabel?: string): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { label: "Home", href: "/" },
  ];

  // Skip home page
  if (pathname === "/") {
    return items;
  }

  const segments = pathname.split("/").filter(Boolean);

  // Map route segments to friendly names
  const routeLabels: Record<string, string> = {
    learn: "Learn",
    practice: "Practice",
    circle: "Circle of Fifths",
    progression: "Chord progression generator",
    progress: "Progress",
    dev: "Dev",
  };

  // Build breadcrumb path
  let currentPath = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    currentPath += `/${segment}`;

    // For dynamic routes, use the provided label or fallback to route label
    const isLast = i === segments.length - 1;
    let label: string;
    
    if (isLast && dynamicLabel) {
      label = dynamicLabel;
    } else {
      label = routeLabels[segment] || segment;
    }

    items.push({
      label,
      href: currentPath,
    });
  }

  return items;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const params = useParams();
  const [dynamicLabel, setDynamicLabel] = useState<string | undefined>();

  // Fetch milestone title for /learn/[key] routes
  useEffect(() => {
    if (pathname.startsWith("/learn/") && params.key) {
      const fetchMilestoneTitle = async () => {
        try {
          const res = await fetch("/api/milestones");
          if (res.ok) {
            const data: { milestones: MilestoneDto[] } = await res.json();
            const milestone = data.milestones.find(
              (m) => m.key === params.key
            );
            if (milestone) {
              setDynamicLabel(milestone.title);
            }
          }
        } catch (err) {
          // Silently fail - will use fallback label
          console.error("Error fetching milestone title:", err);
        }
      };
      void fetchMilestoneTitle();
    }
  }, [pathname, params.key]);

  const items = getBreadcrumbs(pathname, dynamicLabel);

  // Don't show breadcrumb on home page
  if (pathname === "/" || items.length <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-6 flex items-center gap-1.5 text-xs text-muted"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div key={item.href} className="flex items-center gap-1.5">
            {index === 0 ? (
              <Link
                href={item.href}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                aria-label="Home"
              >
                <Home className="w-3.5 h-3.5" />
                <span className="sr-only">{item.label}</span>
              </Link>
            ) : (
              <>
                <ChevronRight className="w-3 h-3 text-muted/50" />
                {isLast ? (
                  <span className="text-foreground font-medium">
                    {item.label}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className="hover:text-foreground transition-colors"
                  >
                    {item.label}
                  </Link>
                )}
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}

