import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const email = process.env.SEED_OWNER_EMAIL;
  if (!email) { console.log("Seed de produção ignorado: defina SEED_OWNER_EMAIL somente quando já houver um usuário."); return; }
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  if (!user?.memberships[0]) throw new Error("Usuário proprietário não encontrado.");
  const householdId = user.memberships[0].householdId;
  for (const [name, icon, color] of [["Moradia","House","#5269E8"],["Alimentação","Utensils","#F59E59"],["Transporte","Car","#11A88B"],["Saúde","HeartPulse","#E36B79"],["Lazer","Sparkles","#8B6DDA"],["Assinaturas","Repeat2","#5687CE"],["Outros","CircleDollarSign","#8491A8"]] as const) {
    await prisma.category.upsert({ where: { householdId_name: { householdId, name } }, create: { householdId, name, icon, color }, update: {} });
  }
  console.log("Categorias iniciais prontas.");
}
main().finally(() => prisma.$disconnect());
