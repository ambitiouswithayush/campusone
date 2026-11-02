"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { act } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { MarkEntry, lockSheet, returnSheet, saveMarks, submitSheet, unlockSheet } from "@/lib/marks";

const Id = z.number().int().positive();
const Reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500);

export async function saveMarksAction(assignmentId: number, entries: MarkEntry[]) {
  return act(async () => {
    const user = await requireUser("faculty", "office_admin");
    const parsed = z.array(MarkEntry).max(5000).parse(entries);
    const r = await saveMarks(await getDb(), user, Id.parse(assignmentId), parsed);
    revalidatePath(`/marks/${assignmentId}`);
    return r;
  });
}

export async function submitSheetAction(assignmentId: number) {
  return act(async () => {
    const user = await requireUser("faculty", "office_admin");
    await submitSheet(await getDb(), user, Id.parse(assignmentId));
    revalidatePath("/marks");
    revalidatePath(`/marks/${assignmentId}`);
  }, "Sent to the exam cell for moderation.");
}

export async function lockSheetAction(assignmentId: number) {
  return act(async () => {
    const user = await requireUser("office_admin");
    await lockSheet(await getDb(), user, Id.parse(assignmentId));
    revalidatePath("/marks");
    revalidatePath(`/marks/${assignmentId}`);
  }, "Moderated and locked.");
}

export async function returnSheetAction(assignmentId: number, reason: string) {
  return act(async () => {
    const user = await requireUser("office_admin");
    await returnSheet(await getDb(), user, Id.parse(assignmentId), Reason.parse(reason));
    revalidatePath("/marks");
    revalidatePath(`/marks/${assignmentId}`);
  }, "Returned to the teacher.");
}

export async function unlockSheetAction(assignmentId: number, reason: string) {
  return act(async () => {
    const user = await requireUser("office_admin");
    await unlockSheet(await getDb(), user, Id.parse(assignmentId), Reason.parse(reason));
    revalidatePath("/marks");
    revalidatePath(`/marks/${assignmentId}`);
  }, "Unlocked. The reason is in the audit log.");
}
