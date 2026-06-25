import { cookies } from "next/headers";
import { getUserClabe } from "@/lib/seyf/spei-deposit-service";
import DepositarClient from "./depositar-client";
import { isDatabaseConfigured } from "@/lib/seyf/db/client";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function DepositarPage() {
  const jar = await cookies();
  const userId = jar.get("seyf_poc_user_id")?.value?.trim() ?? null;

  let initialClabe = null;
  if (userId && UUID_RE.test(userId) && isDatabaseConfigured()) {
    try {
      const record = await getUserClabe(userId);
      if (record) {
        initialClabe = {
          clabe: record.clabe,
          bankName: record.bank_name,
          beneficiaryName: record.beneficiary_name,
          reference: userId.slice(0, 8).toUpperCase(),
          depositLimitMxn: record.deposit_limit_mxn,
        };
      }
    } catch {
      // DB not ready — fall through to client-side provision
    }
  }

  return <DepositarClient initialClabe={initialClabe} />;
}
