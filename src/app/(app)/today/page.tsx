import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { TodayApp } from "./today-app";

export const metadata: Metadata = { title: "Attendance" };

export default async function TodayPage() {
  await requirePageUser("faculty");
  return <TodayApp />;
}
