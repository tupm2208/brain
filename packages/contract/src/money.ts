/**
 * @file Money on an order: ONE shape and ONE set of functions, owned by the contract.
 *
 * In the legacy TopRun system the money formula had to be copied verbatim into three
 * repositories, guarded by a byte-for-byte comparison test. That was the most expensive scar
 * of the old design. Here money has a single shape and a single origin; every other part
 * (server, brain, console) reads the result and never re-derives it.
 */

/** Vietnamese dong, always an integer. Never use fractions for money. */
export type Money = number;

export interface MoneyOnOrder {
  /** Total the customer has to pay for the order. */
  total: Money;
  /** Amount already paid (bank transfer plus deposit). */
  paid: Money;
  /** Still owed. Always `max(0, total - paid)`; nobody is allowed to recompute it. */
  remaining: Money;
  /** Cash collected on delivery. Equals `remaining` for COD orders, otherwise 0. */
  cod: Money;
}

function toInt(value: unknown): Money {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Normalises the money of one order. The server must call this BEFORE returning an order;
 * clients only read the result and must not infer anything from payment status themselves.
 */
export function moneyOnOrder(input: { total: unknown; paid?: unknown; isCod?: boolean }): MoneyOnOrder {
  const total = Math.max(0, toInt(input.total));
  const paid = Math.max(0, toInt(input.paid ?? 0));
  const remaining = Math.max(0, total - paid);
  return { total, paid, remaining, cod: input.isCod === true ? remaining : 0 };
}

/** Whether the order is fully paid. Use this instead of `paid === total` to avoid rounding drift. */
export function isSettled(money: MoneyOnOrder): boolean {
  return money.remaining <= 0;
}

/** Human-readable amount for operators: "3.190.000 đ". Not for calculations. */
export function formatMoney(value: Money): string {
  return `${Math.round(value).toLocaleString("vi-VN")} đ`;
}

/**
 * Money written for the CUSTOMER: `3190000` becomes `"3.190.000đ"`.
 *
 * A single origin, like `moneyOnOrder`: every sentence that quotes a price to a customer must
 * go through here. Two places formatting independently means two spellings in one reply.
 *
 * `Intl.NumberFormat` is deliberately avoided: it depends on the locale data installed on the
 * machine, so the same build would print two different formats on two machines. The thousands
 * separator is a DOT, as is customary in Vietnam, and it is the exact form the brain's number
 * scanner can read back into the original amount.
 *
 * A non-finite value yields an EMPTY string so that the "empty placeholder" guard catches it.
 * Printing "NaNđ" would produce a sentence without digits, invisible to the number gate, while
 * the placeholder would look filled.
 */
export function formatCustomerMoney(value: Money): string {
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.trunc(Math.abs(value));
  const grouped = String(magnitude).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}${grouped}đ`;
}
