const { createHandler } = require('@app-core/server');
const { appLogger } = require('@app-core/logger');
const { handleInstruction } = require('@app/services/payment-instructions.service');

// Remove this in production, but OK for debugging
console.log('payment-instructions.js file loaded');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],

  async onResponseEnd(rc, rs) {
    appLogger.info({ requestContext: rc, response: rs }, 'payment-instructions-request-completed');
  },

  async handler(rc, helpers) {
    try {
      const payload = rc.body;
      const response = await handleInstruction(payload);

      return {
        status: helpers.http_statuses.HTTP_200_OK,
        data: response,
      };
    } catch (err) {
      appLogger.error(err, 'payment-instructions-error');

      return {
        status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
        error: true,
        message: err.message || 'Unable to process payment instruction',
      };
    }
  },
});
