export type DebtProjection = {
  payoffPossible: boolean;
  months: number | null;
  totalPaid: number | null;
  totalInterest: number | null;
  finalPayment: number | null;
};

export function projectDebt(balance: number, monthlyInterestPercent: number, payment: number, maxMonths = 600): DebtProjection {
  const principal = Math.round(balance * 100);
  const monthlyPayment = Math.round(payment * 100);
  const rate = monthlyInterestPercent / 100;
  if (principal <= 0) return { payoffPossible: true, months: 0, totalPaid: 0, totalInterest: 0, finalPayment: 0 };
  if (monthlyPayment <= 0 || rate < 0) return { payoffPossible: false, months: null, totalPaid: null, totalInterest: null, finalPayment: null };

  let outstanding = principal;
  let totalPaid = 0;
  let totalInterest = 0;
  for (let month = 1; month <= maxMonths; month++) {
    const interest = Math.round(outstanding * rate);
    if (monthlyPayment <= interest && outstanding + interest > monthlyPayment) {
      return { payoffPossible: false, months: null, totalPaid: null, totalInterest: null, finalPayment: null };
    }
    totalInterest += interest;
    const due = outstanding + interest;
    const paid = Math.min(monthlyPayment, due);
    outstanding = due - paid;
    totalPaid += paid;
    if (outstanding <= 0) {
      return { payoffPossible: true, months: month, totalPaid: totalPaid / 100, totalInterest: totalInterest / 100, finalPayment: paid / 100 };
    }
  }
  return { payoffPossible: false, months: null, totalPaid: null, totalInterest: null, finalPayment: null };
}
