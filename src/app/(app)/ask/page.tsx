import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb } from "@/db";
import { assistantQueries, campuses } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { AskClient } from "./ask-client";

export const metadata: Metadata = { title: "Ask" };

export default async function AskPage() {
  const user = await requirePageUser("office_admin");
  const db = await getDb();
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, user.campusId));
  const recent = await db
    .selectDistinctOn([assistantQueries.question], { question: assistantQueries.question, createdAt: assistantQueries.createdAt })
    .from(assistantQueries)
    .where(eq(assistantQueries.userId, user.uid))
    .orderBy(assistantQueries.question, desc(assistantQueries.createdAt))
    .limit(30);
  recent.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return (
    <div className="animate-fade-up">
      <PageHeader title="Ask" subtitle={`Plain-English questions about students on ${campus?.name ?? "your campus"}. Read-only — it can look things up but never change anything.`} />
      <AskClient recent={recent.slice(0, 6).map((r) => r.question)} llm={!!process.env.GEMINI_API_KEY} />
    </div>
  );
}
