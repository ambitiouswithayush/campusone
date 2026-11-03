/**
 * Parent message templates. Odia text should be reviewed by a native speaker before go-live
 * (labelled as an assumption in the TDD).
 */
export function shortageMessage(lang: "en" | "or", name: string, pct: number, threshold: number) {
  const p = pct.toFixed(1);
  if (lang === "or") {
    return `ପ୍ରିୟ ଅଭିଭାବକ, ${name}ଙ୍କ ଉପସ୍ଥାନ ${p}% ଅଛି, ଯାହା ଆବଶ୍ୟକ ${threshold}% ରୁ କମ୍। ଦୟାକରି ମେଣ୍ଟରଙ୍କ ସହ ଯୋଗାଯୋଗ କରନ୍ତୁ। - CampusOne`;
  }
  return `Dear parent, ${name}'s attendance is ${p}%, below the required ${threshold}%. Please contact the mentor. - CampusOne`;
}

/** Indian SMS convention: DD-MM-YYYY, the same in both languages. */
function smsDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export function feeReminderMessage(lang: "en" | "or", name: string, amount: string, dueIso: string) {
  const dueDate = smsDate(dueIso);
  if (lang === "or") {
    return `ପ୍ରିୟ ଅଭିଭାବକ, ${name}ଙ୍କ ${amount} ଫି ବାକି ଅଛି (ଶେଷ ତାରିଖ ${dueDate})। ଦୟାକରି ଶୀଘ୍ର ପୈଠ କରନ୍ତୁ। - CampusOne`;
  }
  return `Dear parent, a fee of ${amount} is due for ${name} (due ${dueDate}). Please pay at the earliest. - CampusOne`;
}
