// Sprawdza integralność łańcucha hashy w dzienniku zdarzeń: npm run audit:verify
import { prisma } from '../db';
import { verifyAuditChain } from '../lib/audit';

const result = await verifyAuditChain();
if (result.brokenIds.length === 0) {
  console.log(`OK – sprawdzono ${result.checked} wpisów, łańcuch nienaruszony.`);
} else {
  console.error(`UWAGA – ${result.brokenIds.length} wpisów z naruszoną integralnością: ${result.brokenIds.slice(0, 50).join(', ')}`);
  process.exitCode = 1;
}
await prisma.$disconnect();
