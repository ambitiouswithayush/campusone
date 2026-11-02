"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="w-full">
      <Printer size={15} /> Print or save as PDF
    </Button>
  );
}
