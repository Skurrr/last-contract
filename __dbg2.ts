import { ALL_WEAPONS } from '@/data/index';
import { ENEMIES } from '@/data/enemies';
for (const e of Object.values(ENEMIES)) {
  console.log(e.id, e.weapon, ALL_WEAPONS[e.weapon] ? 'OK' : 'MISSING', e.sidearm ?? '-', e.sidearm ? (ALL_WEAPONS[e.sidearm] ? 'OK' : 'MISSING') : '');
}
