import { Card, Skeleton } from "@/components/ui";

/** Shown inside the shell while a page's server data loads. Mirrors the shared page layout. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] w-full" />)}
      </div>
      <Card className="space-y-3 p-5">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </Card>
    </div>
  );
}
