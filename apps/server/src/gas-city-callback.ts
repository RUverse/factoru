import { createHash } from 'node:crypto'
import { z } from 'zod'

/** Gas City appends `/publish` to the adapter callback URL. */
export const GAS_CITY_CALLBACK_BASE_PATH = '/internal/v1/gas-city/extmsg/callback'
export const GAS_CITY_CALLBACK_PATH = `${GAS_CITY_CALLBACK_BASE_PATH}/publish`

export const gasCityOutboundCallbackSchema = z.object({
  session_id: z.string().min(1).max(200),
  conversation: z.object({
    scope_id: z.string().min(1).max(200),
    provider: z.literal('factoru'),
    account_id: z.string().min(1).max(200),
    conversation_id: z.string().min(1).max(200),
    kind: z.literal('dm'),
  }),
  text: z.string().min(1).max(60_000),
  idempotency_key: z.string().min(1).max(500).optional(),
  reply_to_message_id: z.string().max(200).optional(),
})

export type GasCityOutboundCallback = z.infer<typeof gasCityOutboundCallbackSchema>

/** Stable provider ID returned to Gas City when it retries the same publish. */
export function gasCityCallbackMessageId(input: GasCityOutboundCallback): string {
  const identity =
    input.idempotency_key ??
    [
      input.session_id,
      input.conversation.conversation_id,
      input.reply_to_message_id ?? '',
      input.text,
    ].join('\0')
  return `factoru-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}
