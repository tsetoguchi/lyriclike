// The reminders Worker: a daily cron that sends the "your song is waiting"
// emails. The work is the site's own code (functions/_reminders.js), bundled
// in by wrangler, so the rules live in one place.
import { sendDueReminders } from '../../functions/_reminders.js';

const HTTP_NOT_FOUND = 404;

// The mail helpers log through writeLog, which reads its request for an IP
// and a platform. A cron has neither, so this stands in with no headers.
function cronContext(env) {
  return { env, request: new Request(env.APP_BASE_URL) };
}

const REQUIRED_SETTINGS = ['RESEND_API_KEY', 'EMAIL_FROM', 'REMINDER_SIGNING_SECRET'];

// Until every secret is set, nobody is claimed as due and no mail is counted.
export async function runReminders(env, now = Date.now()) {
  const missing = REQUIRED_SETTINGS.filter(name => !env[name]);
  if (missing.length > 0) {
    console.log('song reminders skipped, missing', missing.join(', '));
    return { skipped: missing };
  }
  const result = await sendDueReminders(cronContext(env), now);
  console.log('song reminders', JSON.stringify(result));
  return result;
}

export default {
  fetch() {
    return new Response(null, { status: HTTP_NOT_FOUND });
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runReminders(env, controller.scheduledTime));
  },
};
