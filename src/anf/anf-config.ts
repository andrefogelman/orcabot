export const anfConfig = {
  anthropicBaseUrl:
    process.env.ANTHROPIC_BASE_URL || 'http://100.91.255.19:8100',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || 'placeholder',
  adminWhatsapp: process.env.ADMIN_WHATSAPP || '5511993604399',
  port: parseInt(process.env.PORT || '3100', 10),
};
