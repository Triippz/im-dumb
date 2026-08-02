import { type Profile, load } from './profile.ts';

export interface PiExtensionApi {
  on(event: string, handler: (event: { systemPrompt: string }) => unknown): void;
}

export function formatProfileReminder(profile: Profile): string {
  const lines = [
    'im-dumb profile active. Apply on every reply:',
    `- vocabulary: ${profile.vocabulary_level}; jargon: ${profile.jargon_policy}`,
    `- sentences at most ${profile.sentence_length_cap} words; ${profile.paragraph_topic_limit} topic per paragraph`,
    `- tone: ${profile.tone}; shape: ${profile.output_shape}`,
  ];
  if (profile.adhd_mode) lines.push('- ADHD mode: lead with the answer, then short chunks');
  if (profile.forbidden_phrases.length > 0) {
    lines.push(`- never write: ${profile.forbidden_phrases.join(', ')}`);
  }
  if (profile.known_gap_types.length > 0) {
    const gaps = profile.known_gap_types.map((gap) => `${gap.type} ${gap.confidence}`).join(', ');
    lines.push(`- known gaps: ${gaps}`);
  }
  return lines.join('\n');
}

export default function imDumbExtension(pi: PiExtensionApi): void {
  pi.on('before_agent_start', (event) => {
    const outcome = load();
    if (!outcome.ok) return undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${formatProfileReminder(outcome.profile)}` };
  });
}
