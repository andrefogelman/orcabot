import { supabase } from '../supabase-client.js';
import { anfConfig } from './anf-config.js';

export async function notifyAdmin(message: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-whatsapp', {
      body: {
        phone: anfConfig.adminWhatsapp,
        message: `🤖 ANF-nano: ${message}`,
      },
    });
    if (error) console.error('[whatsapp] Failed:', error.message);
  } catch (err: any) {
    console.error('[whatsapp] Error:', err.message);
  }
}
