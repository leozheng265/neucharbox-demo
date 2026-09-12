// Typed-request routing: what a first-time visitor might type, and what the demo must do with it.
// 'refuse' = a negated request is not turned into its opposite; 'clarify' = vague text gets the chips back;
// anything else = the start of the chip it must run. Uses interpret(), the same function main.js calls.
import { interpret } from '../js/engine/match.js';

export const CASES = {
  home: [
    ["I'm away until Sunday, keep the place looking lived in", "I'm away"],
    ["dont let my plants die", "I'm away"],
    ["water my plants while im away", 'Just keep the plants alive'],
    ["don't forget to water the plants", 'Just keep the plants alive'],
    ["make it look like someones home at night", 'Make it look like someone'],
    ["let me know if someone rings the doorbell", 'Hold the house'],
    ["keep an eye on the front door", 'Hold the house'],
    ["keep the house warm while I'm away", 'Hold the house'],
    ["don't let the pipes freeze while I'm gone", 'Hold the house'],
    ["what's the weather like", 'clarify'],
  ],
  lab: [
    ['open the shutter please', 'Open the shutter'],
    ['open the shutter then close it after a second', 'Open the shutter'],
    ['rotate the mirror slightly and read the meter', 'Tilt M2'],
    ['move stage x to 12.4mm', 'Move stage X'],
    ['align the beam', 'Walk M2'],
    ['max power', 'Walk M2'],
    ['do not open the shutter', 'refuse'],
    ['close the shutter', 'refuse'],
    ['turn off the laser', 'refuse'],
    ['keep the shutter closed, do not open it', 'refuse'],
    ["don't touch anything", 'refuse'],
    ["what's the power reading", 'clarify'],
    ['r u a real lab?', 'clarify'],
  ],
  elder: [
    ['tell me when mum wakes up', 'Let me know when mum'],
    ['no cameras in her room please', 'Let me know when mum'],
    ['is she up yet', 'Let me know when mum'],
    ["I don't want a camera in her bedroom, just let me know when she's up", 'Let me know when mum'],
    ['help her not fall at night', 'If she gets up at night'],
    ['never let mum fall', 'If she gets up at night'],
    ['dont let the kettle boil dry', 'Tell me if the kettle'],
    ['tell me if she leaves the kettle on', 'Tell me if the kettle'],
    ['what if she leaves something on', 'Tell me if the kettle'],
    ['is the kettle safe', 'Tell me if the kettle'],
    ['so how does this work', 'clarify'],
  ],
  warehouse: [
    ['ship todays orders to dock 2', 'Move today'],
    ['start everything', 'Move today'],
    ['send fragile stuff to lane b', 'Divert anything'],
    ['STOP!!!', 'Stop everything'],
    ['shut down the line', 'Stop everything'],
    ['kill the conveyor', 'Stop everything'],
    ['turn off the conveyors', 'Stop everything'],
    ['abort', 'Stop everything'],
    ["don't stop the line", 'refuse'],
  ],
  creator: [
    ['go live pls', 'Go live.'],
    ['turn on the on-air sign', 'Go live.'],
    ['turn on the stream', 'Go live.'],
    ['turn the stream on', 'Go live.'],
    ['go live but keep the mic muted', 'Go live.'],
    ['im done, end the stream', "I'm done. Wrap up."],
    ['mic off', "I'm done. Wrap up."],
    ['turn off the camera', "I'm done. Wrap up."],
    ['record a video without streaming', 'Recording only'],
    ["I don't want to stream tonight, just record", 'Recording only'],
    ["don't go live", 'refuse'],
    ["I really don't want to go live", 'refuse'],
    ["we're not going live today", 'refuse'],
    ['never mind', 'refuse'],
  ],
};

export function routingChecks({ report, scenes }) {
  for (const [id, cases] of Object.entries(CASES)) {
    const scene = scenes[id]; if (!scene) continue;
    const problems = [];
    for (const [text, want] of cases) {
      const r = interpret(text, scene.prompts);
      const got = r.action === 'run' ? r.prompt.chip : r.action;
      const ok = want === 'refuse' || want === 'clarify' ? r.action === want : r.action === 'run' && r.prompt.chip.startsWith(want);
      if (!ok) problems.push(`"${text}" → ${r.action === 'run' ? `runs "${got.slice(0, 40)}"` : got} (score ${r.score}), expected ${want === 'refuse' || want === 'clarify' ? want : `"${want}…"`}`);
    }
    // every chip must still run itself
    for (const p of scene.prompts) { const r = interpret(p.chip, scene.prompts); if (r.action !== 'run' || r.prompt !== p) problems.push(`chip "${p.chip.slice(0, 40)}" → ${r.action} ${r.action === 'run' ? `"${r.prompt.chip.slice(0, 30)}"` : ''}`); }
    report(`${id} · typed requests route correctly (${cases.length} phrasings)`, problems);
  }
}
