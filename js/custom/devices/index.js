// The custom room's device UI registry: one entry per catalog type (js/custom/catalog.js), merged from the category
// files (each `export default { [type]: ui }`). An entry:
//   { icon, size, mountY?, plural?, format(s), active?(s), control?, model }
//   icon      a key of ICONS (js/engine/icons.js), for the card and the inventory tile
//   size      the footprint in metres: along the wall for a wall mount, else its width and depth (the layout keeps it
//             size/2 from every wall, so the model must fit in a size × size square at any turn)
//   mountY    a wall mount's centre height (default 1.4)
//   plural    true for a name that takes a plural verb ("the blinds fail")
//   format    the card's status line for a slice: "full" and "closed" at the ends, never "100%" (copy guardrails)
//   active    optional; true lights the card as on (panel.js guesses from the state without it)
//   control   the card control, as js/engine/controls.js reads it: { kind: 'bar', field, min, max } · { kind: 'switch',
//             field } · false for none
//   model({ THREE, P, M }) → { root, update(slice, t, env), pick? }
//             Built from parts.js primitives and THREE geometry only (no model files), at the local origin, all under
//             `root`: the footprint centre on its mount surface. A floor model stands on y = 0; a wall model has its back
//             face at z = 0 and faces +z, centred on y = 0 (room3d hangs it at mountY); a ceiling model hangs down from
//             y = 0. update() runs every frame and must show every state the catalog can reach, a 'fault' status as a
//             red LED or tint and 'offline' as a dark LED; env = { hour, sky } is the light outside (room3d.js skyAt:
//             0 at night, 1 by day), for parts that show it; pick is what a tap selects (default: root).
import home from './home.js';
import elder from './elder.js';
import creator from './creator.js';
import lab from './lab.js';
import warehouse from './warehouse.js';
import living from './living.js';

function merge(...files) {
  const out = {};
  for (const file of files) for (const [type, ui] of Object.entries(file)) {
    if (type in out) throw new Error(`devices: ${type} is defined twice`);
    out[type] = ui;
  }
  return Object.freeze(out);
}

export const DEVICE_UI = merge(home, elder, creator, lab, warehouse, living);
