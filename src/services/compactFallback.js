export function detectLang(text = '') {
  const t = String(text || '');
  const hasCyr = /[а-яё]/i.test(t);
  return hasCyr ? 'ru' : 'en';
}

function hasHighScamSignals(text = '') {
  const t = String(text || '').toLowerCase();
  const ru = /(срочно|перевед|деньг|банк|парол|код|sms|ссылка|мессенджер|телегр|ватсап)/i;
  const en = /(urgent|now|immediate|money|bank|password|code|sms|link|telegram|whatsapp)/i;
  return ru.test(t) || en.test(t);
}

function askQuestion({ lang, mode = 'text', text = '', context = '', images = [] }) {
  const t = String(text || '').toLowerCase();
  const c = String(context || '').toLowerCase();
  const hasImg = Array.isArray(images) && images.length > 0;
  const hasCode = /(код|code|sms|otp|парол)/i.test(t) || /(код|code|sms|otp|парол)/i.test(c);
  const hasSwitch = /(telegram|телегр|whatsapp|ватсап|мессенджер|messenger)/i.test(t) || /(telegram|телегр|whatsapp|ватсап|мессенджер|messenger)/i.test(c);
  const hasDeadline = /(срок|minutes|минут|deadline|5\s*минут|час|hours|секунд|seconds)/i.test(t) || /(срок|minutes|минут|deadline|5\s*минут|час|hours|секунд|seconds)/i.test(c);
  const hasMoney = /(деньг|перевод|оплат|банк|карта|crypto|крипто|счёт)/i.test(t) || /(money|transfer|payment|bank|card|wallet|crypto)/i.test(c);
  const hasLink = /(ссылка|link|url)/i.test(t) || /(ссылка|link|url)/i.test(c);
  const hasPhoto = /(фото|photo|профил|profile)/i.test(t) || /(фото|photo|профил|profile)/i.test(c);

  // RU
  if (lang === 'ru') {
    if (hasImg || mode !== 'text') {
      if (hasCode && hasDeadline) return 'Ask: Почему код нужно отправить в течение нескольких минут, как видно на скрине?';
      if (hasCode) return 'Ask: Зачем на скрине просят код из SMS — для чего это?';
      if (hasSwitch) return 'Ask: Зачем переход на мессенджер, если на скрине уже есть чат?';
      if (hasMoney) return 'Ask: Куда именно на скрине просят перевести деньги и почему?';
      if (hasLink) return 'Ask: К какой цели ведёт указанная на скрине ссылка и можно ли проверить источник?';
      if (hasPhoto) return 'Ask: Что на скрине подтверждает подлинность профиля (имя, дата, логотип)?';
      return 'Ask: Какие детали на скрине подтверждают реальность (имена, даты, логотипы)?';
    }
    if (hasCode) return 'Ask: Зачем собеседнику код из SMS, на что он будет использован?';
    if (hasSwitch) return 'Ask: Зачем просит перейти в мессенджер, чем текущий канал не устраивает?';
    if (hasMoney) return 'Ask: Почему нужны деньги и на что именно они требуются?';
    if (hasDeadline) return 'Ask: Кто устанавливает срочные сроки и почему это важно сейчас?';
    if (hasLink) return 'Ask: Куда ведёт ссылка и можно ли проверить её источник?';
    return 'Ask: Какие факты из переписки подтверждают реальность (имена, даты, ссылки)?';
  }

  // EN
  if (hasImg || mode !== 'text') {
    if (hasCode && hasDeadline) return 'Ask: Why must the code be sent within a few minutes, as shown on the screenshot?';
    if (hasCode) return 'Ask: Why is an SMS code requested on the screenshot — for what purpose?';
    if (hasSwitch) return 'Ask: Why switch to a messenger if the chat already exists on the screenshot?';
    if (hasMoney) return 'Ask: Where exactly on the screenshot are you asked to transfer money, and why?';
    if (hasLink) return 'Ask: What is the purpose of the link shown on the screenshot, and can its source be verified?';
    if (hasPhoto) return 'Ask: What on the screenshot confirms the profile’s authenticity (name, date, logo)?';
    return 'Ask: Which details on the screenshot confirm authenticity (names, dates, logos)?';
  }
  if (hasCode) return 'Ask: Why is an SMS code needed, and how will it be used?';
  if (hasSwitch) return 'Ask: Why do they insist on switching to a messenger; what’s wrong with this channel?';
  if (hasMoney) return 'Ask: Why is money required, and for what exactly?';
  if (hasDeadline) return 'Ask: Who sets the urgent deadlines, and why is it critical now?';
  if (hasLink) return 'Ask: Where does the link lead, and can the source be verified?';
  return 'Ask: What facts in the conversation verify authenticity (names, dates, links)?';
}

export function compactFallback({ mode = 'text', text = '', context = '', images = [] }) {
  const lang = detectLang(text || context);
  const high = hasHighScamSignals(text) || hasHighScamSignals(context);
  let s1 = '';
  let s2 = '';
  if (lang === 'ru') {
    s1 = high ? 'Это мошенничество.' : 'Есть риск мошенничества.';
    s2 = high ? 'Прекратите общение и заблокируйте пользователя.' : 'Действуйте осторожно и ничего не отправляйте.';
  } else {
    s1 = high ? 'This is fraud.' : 'There is potential risk.';
    s2 = high ? 'Stop communicating and block the user.' : 'Proceed cautiously and do not send any codes.';
  }
  const ask = askQuestion({ lang, mode, text, context, images });
  return `${s1} ${s2} ${ask}`;
}