// Регуляторные триггеры (spec 005): подсказка, какие ведомства США стоит проверить ДО заказа партии.
// Работает по английским словам в названии ниши, главном ключе, заголовках листингов и поисковых запросах.
// kind: "product" — требование следует из типа товара; "claim" — из обещания в листинге (от обещания можно отказаться и снять требование).
// Это не юридическая проверка: сработавший триггер — повод открыть правила ведомства и требования категории Amazon, статус всегда «допущение».
const rx = (s) => new RegExp("\\b(?:" + s + ")", "i");

export const REG_RULES = [
  { id: "fda-supplement", agency: "FDA", kind: "product", title: "Пищевые добавки", re: rx("supplements?\\b|vitamins?\\b|probiotics?\\b|multivitamin|gummies\\b|protein powder|collagen (?:powder|peptides)|pre-?workout|melatonin|ashwagandha|creatine|electrolyte (?:powder|drink)"),
    meaning: "Добавки: производство по cGMP, этикетка Supplement Facts, запрет на обещания лечения. Amazon требует документы (COA от лаборатории, письмо о соответствии) — без них листинг снимают." },
  { id: "fda-food", agency: "FDA", kind: "product", title: "Продукты питания и напитки", re: rx("snacks?\\b|candy\\b|candies\\b|chocolate\\b|coffee beans?|ground coffee|tea bags?|loose leaf tea|honey\\b|spices?\\b|seasoning|sauce\\b|syrup\\b|jerky|dried fruit|baby food|infant formula"),
    meaning: "Еда: регистрация производства в FDA (food facility), этикетка с составом и аллергенами, сроки годности; для импорта — предварительное уведомление FDA. Категория Grocery на Amazon закрытая." },
  { id: "fda-cosmetic", agency: "FDA", kind: "product", title: "Косметика", re: rx("serum\\b|moisturizer|face cream|body lotion|lotion\\b|shampoo|conditioner\\b|body wash|lip ?stick|lip balm|mascara|eyeliner|foundation makeup|nail polish|face mask sheet|skincare|skin care|perfume|cologne\\b|deodorant\\b"),
    meaning: "Косметика: закон MoCRA — регистрация производства и перечня продуктов в FDA, ответственное лицо в США на этикетке, учёт жалоб. Состав по INCI, запрещённые красители." },
  { id: "fda-otc", agency: "FDA", kind: "product", title: "Безрецептурные лекарства (OTC)", re: rx("sunscreen|\\bspf ?\\d+|acne (?:treatment|patch|cream)|antiperspirant|hand sanitizer|pain relie(?:f|ving)|anti-?dandruff|fluoride toothpaste|antifungal|hydrocortisone|lidocaine|wart remover|eye drops|nasal spray|cough drops"),
    meaning: "По правилам FDA это лекарство, а не косметика: монография OTC, регистрация производителя и NDC-код, этикетка Drug Facts. Вход заметно дороже и дольше обычного товара." },
  { id: "fda-device", agency: "FDA", kind: "product", title: "Медицинские изделия", re: rx("thermometer|blood pressure|pulse oximeter|oximeter|tens unit|hearing (?:aid|amplifier)|contact lens|breast pump|condoms?\\b|surgical mask|kn95|n95\\b|nasal aspirator|glucose|nebulizer|orthopedic brace|knee brace|posture corrector|heating pad|massage gun|teeth whitening|night guard|mouth guard|pregnancy test|first aid kit|bandages?\\b|compression socks"),
    meaning: "Медицинское изделие: класс I/II по FDA, регистрация производителя и листинг изделия, для части товаров — уведомление 510(k). Amazon запрашивает подтверждение регистрации." },
  { id: "fda-claim", agency: "FDA", kind: "claim", title: "Обещания лечения", re: rx("cures?\\b|treats?\\b|heals?\\b|healing\\b|anti-?inflammatory|relieves? (?:pain|arthritis|anxiety|stress)|arthritis|eczema|psoriasis|insomnia|lowers? (?:blood pressure|cholesterol)|boosts? immun|detox\\b|weight loss|fat burn"),
    meaning: "Обещание лечить или предотвращать болезнь превращает товар в лекарство с точки зрения FDA. Конкуренты с такими словами рискуют листингом; свой листинг стройте без них." },
  { id: "fda-foodcontact", agency: "FDA", kind: "product", title: "Контакт с пищей", re: rx("cutting board|water bottles?\\b|tumbler|travel mug|coffee mug|lunch ?box|bento|food storage|food container|meal prep container|baking mat|silicone (?:mold|spatula|lid)|baby bottle|sippy cup|straws?\\b|utensils?\\b|cookware|frying pan|dinnerware|plates?\\b|bowls?\\b|ice cube tray|kitchen tongs"),
    meaning: "Материалы, контактирующие с пищей, должны соответствовать требованиям FDA (food grade, 21 CFR); для керамики и стекла — тест на свинец и кадмий. Amazon может запросить протоколы испытаний." },
  { id: "fda-laser", agency: "FDA", kind: "product", title: "Лазеры и УФ-излучение", re: rx("laser pointer|laser level|laser hair removal|ipl hair removal|uv (?:lamp|light|sanitizer|wand)|uvc\\b|tanning lamp"),
    meaning: "Изделия с лазером или УФ-излучением: отчёт в FDA (CDRH) и маркировка класса лазера; лазерные указки мощнее 5 мВт на Amazon запрещены." },
  { id: "epa-pesticide", agency: "EPA", kind: "product", title: "Пестициды и средства от вредителей", re: rx("insect repellent|mosquito repellent|bug spray|bug killer|insecticide|pesticide|ant (?:bait|killer)|roach (?:bait|killer)|rodent(?:icide)?|rat poison|mouse poison|weed killer|herbicide|fungicide|flea (?:and|&) tick|flea (?:collar|treatment|spray)|tick repellent|moth balls?|termite|bed bug (?:spray|killer)|disinfectants?\\b|disinfecting wipes|algaecide|mold (?:killer|remover)|mildew remover"),
    meaning: "Средство, которое убивает или отпугивает вредителей либо микробов, — пестицид по закону FIFRA: нужна регистрация EPA (годы и десятки тысяч долларов) либо узкое исключение 25(b). Amazon требует пройти обучение и одобрение категории Pesticides." },
  { id: "epa-device", agency: "EPA", kind: "product", title: "Пестицидные устройства", re: rx("ultrasonic (?:pest|rodent|mosquito)|pest repeller|bug zapper|mosquito (?:trap|zapper|killer lamp)|fly trap|mouse trap|rat trap|water filter|air purifier|uv sanitizer|ozone generator"),
    meaning: "Устройства против вредителей и микробов (ловушки, ультразвук, УФ, фильтры с обещанием убивать бактерии) регистрации EPA не требуют, но производство должно иметь номер EPA Establishment, он ставится на упаковку." },
  { id: "epa-claim", agency: "EPA", kind: "claim", title: "Антимикробные обещания", re: rx("anti-?bacterial|anti-?microbial|kills? (?:germs|bacteria|viruses|mold|99)|germ[- ]?(?:free|killing)|disinfect\\w*|sanitiz\\w*|steriliz\\w*|anti-?viral|anti-?fungal|mold[- ]resistant|mildew[- ]resistant|repels? (?:insects|mosquitoes|bugs|ticks)|bug[- ]repellent|odor[- ]killing bacteria"),
    meaning: "Слова «antibacterial», «kills germs», «repels insects» делают из обычного товара пестицид: EPA штрафует продавцов, Amazon снимает листинги. Исключение «treated article» узкое — защищать можно только сам товар, не человека. От обещания можно отказаться." },
  { id: "cpsc-children", agency: "CPSC", kind: "product", title: "Детские товары", re: rx("bab(?:y|ies)\\b|infants?\\b|newborn|toddlers?\\b|kids?\\b|child(?:ren)?(?:'s)?\\b|teethers?\\b|teething|pacifier|crib\\b|bassinet|stroller|car seat|high chair|toys?\\b|playpen|nursery|diaper|sippy|rattle|play ?mat|montessori"),
    meaning: "Товар для детей до 12 лет: закон CPSIA — испытания в аккредитованной CPSC лаборатории (свинец, фталаты, мелкие детали), сертификат Children's Product Certificate, постоянная маркировка партии. Для игрушек — стандарт ASTM F963. Amazon запрашивает документы до запуска." },
  { id: "cpsc-sleep", agency: "CPSC", kind: "product", title: "Детский сон и одежда для сна", re: rx("crib (?:mattress|bumper)|baby (?:lounger|nest|sleeper)|inclined sleeper|weighted (?:sleep sack|swaddle|blanket for (?:baby|infant))|kids? pajamas|children'?s sleepwear|toddler pajamas"),
    meaning: "Товары для сна младенцев под особым контролем CPSC: часть изделий запрещена (наклонные люльки, бортики), детская одежда для сна обязана пройти тест на воспламеняемость (16 CFR 1615/1616)." },
  { id: "cpsc-hazard", agency: "CPSC", kind: "product", title: "Товары с отдельными стандартами безопасности", re: rx("bike helmet|bicycle helmet|helmets?\\b|bunk bed|dresser\\b|chest of drawers|magnet(?:ic)? (?:balls|cubes|toys)|neodymium|button (?:cell|batter)|coin batter|lighters?\\b|fire ?pit|space heater|portable generator|hoverboard|e-?scooter|e-?bike|trampoline|drawstring|adult portable bed rail|infant walker|gas can"),
    meaning: "Для этого типа товара у CPSC есть обязательный стандарт (шлемы, комоды — закон STURDY, сильные магниты, батарейки-таблетки — закон Reese's Law и т. д.): нужны испытания и сертификат General Certificate of Conformity." },
  { id: "fcc-radio", agency: "FCC", kind: "product", title: "Радиомодули: Bluetooth, Wi-Fi, беспроводное", re: rx("bluetooth|wi-?fi\\b|wireless\\b|walkie[- ]talkie|two[- ]way radio|rf remote|remote control|smart (?:plug|bulb|lock|watch|home)|gps tracker|baby monitor|earbuds|headphones|speaker\\b|drone\\b|key finder|wireless charger"),
    meaning: "Устройство с радиопередатчиком: обязательная сертификация FCC с номером FCC ID на корпусе. Проверьте, что у поставщика сертификат на именно эту модель, а не «похожую»." },
  { id: "fcc-digital", agency: "FCC", kind: "product", title: "Электроника без радио", re: rx("led (?:strip|light|lamp|bulb)|usb (?:hub|charger|cable)|power bank|charger\\b|charging (?:station|cable)|keyboard\\b|webcam|monitor\\b|projector|digital (?:scale|clock|timer)|electric (?:toothbrush|shaver|kettle)|hair dryer|fan\\b|humidifier|diffuser"),
    meaning: "Цифровая электроника без передатчика: декларация соответствия FCC (SDoC) по излучению помех — протокол испытаний и ответственное лицо в США." },
  { id: "ul-electrical", agency: "UL / NRTL", kind: "product", title: "Питание от сети и литиевые батареи", re: rx("power strip|extension cord|surge protector|space heater|hair dryer|curling iron|flat iron|hair straightener|electric blanket|heating pad|string lights|christmas lights|power bank|lithium|battery pack|e-?bike|hoverboard|wall charger|usb charger|air fryer|toaster|blender\\b|electric kettle|slow cooker|heated"),
    meaning: "Для сетевых приборов и литиевых батарей Amazon требует протоколы испытаний по стандартам UL (зарядные — UL 62368-1, пауэрбанки — UL 2056, гирлянды — UL 588, микромобильность — UL 2272/2849) от лаборатории NRTL. Без них листинг блокируют." },
  { id: "dot-hazmat", agency: "DOT / Amazon Hazmat", kind: "product", title: "Опасные грузы (hazmat)", re: rx("lithium|batter(?:y|ies)\\b|aerosol|spray paint|flammable|nail polish|perfume|cologne\\b|essential oils?\\b|fragrance oil|alcohol[- ]based|hand sanitizer|lighter fluid|butane|propane|compressed (?:air|gas)|air duster|bleach|drain cleaner|adhesive|super glue|epoxy|paint thinner|matches\\b|magnets?\\b|fire extinguisher|bear spray|pepper spray"),
    meaning: "Товар может классифицироваться как опасный груз: нужен паспорт безопасности (SDS) или лист исключения, для батарей — тест UN 38.3. На складах FBA для hazmat отдельные лимиты и сборы, авиадоставка из Китая ограничена — закладывайте это в срок и цену поставки." },
  { id: "prop65", agency: "California Prop 65", kind: "product", title: "Материалы с предупреждением Prop 65", re: rx("pvc\\b|vinyl\\b|brass\\b|lead crystal|ceramic\\b|faux leather|pu leather|leatherette|bpa\\b|phthalate|vintage glassware|fishing (?:weights?|sinkers?)|solder"),
    meaning: "В материалах такого типа часто находят вещества из списка Калифорнии (свинец, фталаты, кадмий): либо протокол испытаний, либо предупреждение Prop 65 на упаковке и в листинге. Иски по Prop 65 против мелких продавцов — обычная практика." },
  { id: "ftc-green", agency: "FTC / USDA", kind: "claim", title: "Обещания «organic», «eco», «made in USA»", re: rx("organic\\b|usda\\b|biodegradable|compostable|eco-?friendly|non-?toxic|bpa[- ]free|chemical[- ]free|hypoallergenic|made in (?:the )?usa|american made|dermatologist (?:tested|recommended)|clinically (?:proven|tested)"),
    meaning: "Такие слова должны быть подтверждены: «organic» — сертификат USDA, «made in USA» — правило FTC «all or virtually all», экологические обещания — FTC Green Guides, «clinically proven» — исследование. Неподтверждённое обещание — риск жалобы конкурента и снятия листинга." },
  { id: "usda-plants", agency: "USDA APHIS", kind: "product", title: "Семена и живые растения", re: rx("(?:flower|vegetable|herb|grass|plant|garden|heirloom|tree|wildflower) seeds|seeds? for planting|live plants?\\b|bulbs for planting|succulents? live|bonsai tree live"),
    meaning: "Семена и живые растения: ввоз в США — только с фитосанитарным сертификатом и разрешением APHIS, Amazon запрещает продажу семян из-за рубежа. Реально только с поставщиком внутри США." },
  { id: "pet-fda", agency: "FDA CVM / AAFCO", kind: "product", title: "Корма и добавки для животных", re: rx("(?:dog|cat|pet|puppy|kitten) (?:food|treats?|supplements?|vitamins?|chews?|probiotics?)|calming chews|hip (?:and|&) joint|fish oil for dogs|catnip"),
    meaning: "Корма и добавки для животных регулирует FDA (центр ветеринарии) и штаты по правилам AAFCO: состав, этикетка, гарантированный анализ, запрет на лечебные обещания." },
];

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * @param {object} p { niche, coreKeyword, xray, poe, cerebro } — вся ниша
 */
export function regulatoryTriggers(p) {
  const titles = [...(p.xray?.asins || []).slice(0, 60).map((a) => a.title), ...(p.poe?.asinMetrics || []).slice(0, 60).map((a) => a.title)].map(norm).filter(Boolean);
  const uniqTitles = [...new Set(titles)];
  const terms = [...new Set([...(p.poe?.searchTermMetrics || []).slice(0, 30).map((t) => t.term), ...(p.cerebro?.keywords || []).slice(0, 30).map((k) => k.phrase)].map(norm).filter(Boolean))];
  const head = [norm(p.niche), norm(p.coreKeyword)].filter(Boolean);
  const out = { checked: { titles: uniqTitles.length, terms: terms.length, head: head.length }, triggers: [], note: "Подсказка по словам ниши, а не юридическая проверка. Сработавший триггер — повод открыть правила ведомства и требования категории Amazon до заказа партии." };
  if (!head.length && !uniqTitles.length && !terms.length) return out;
  for (const rule of REG_RULES) {
    const words = new Set(); const grab = (text) => { const m = rule.re.exec(text); if (m) { words.add(m[0].trim()); return true; } return false; };
    const inHead = head.filter(grab).length > 0, hitTitles = uniqTitles.filter(grab), hitTerms = terms.filter(grab);
    const share = uniqTitles.length ? hitTitles.length / uniqTitles.length : 0;
    // чтобы одно случайное слово в одном заголовке не поднимало тревогу: нужен либо сам запрос/название ниши, либо заметная доля заголовков, либо несколько запросов
    const fires = rule.kind === "claim" ? inHead || hitTitles.length >= 2 : inHead || (hitTitles.length >= 2 && share >= 0.10) || hitTerms.length >= 2;
    if (!fires) continue;
    out.triggers.push({ id: rule.id, agency: rule.agency, kind: rule.kind, title: rule.title, meaning: rule.meaning, words: [...words].slice(0, 6),
      where: { head: inHead, titles: hitTitles.length, titleShare: share, terms: hitTerms.length }, examples: hitTitles.slice(0, 2).map((t) => t.slice(0, 110)) });
  }
  out.triggers.sort((a, b) => Number(b.where.head) - Number(a.where.head) || b.where.titleShare - a.where.titleShare);
  return out;
}
