import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { campuses } from "@/db/schema";
import { Shell } from "@/components/shell";
import { requirePageUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const db = await getDb();
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, user.campusId));
  return (
    <Shell role={user.role} name={user.name} campus={campus?.name ?? ""}>
      {children}
    </Shell>
  );
}
