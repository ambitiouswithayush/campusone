"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { act } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { runDailyJobs } from "@/lib/jobs";

export async function runJobsAction() {
  return act(async () => {
    const user = await requireUser("office_admin");
    const r = await runDailyJobs(await getDb(), user.campusId);
    revalidatePath("/dashboard");
    return r;
  });
}
