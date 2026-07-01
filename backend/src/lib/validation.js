// Приводим казахстанский номер к формату +7XXXXXXXXXX
// Возвращает { ok: true, phone: '+77012345678' } или { ok: false, error: '...' }
export function validateKZPhone(input) {
    if (!input || typeof input !== 'string') {
        return { ok: false, error: 'phone_required' };
    }

    // Убираем всё кроме цифр
    const digits = input.replace(/\D/g, '');

    // Форматы, которые принимаем:
    // 77012345678 (11 цифр, начинается на 7 или 8)
    // 87012345678
    // 7012345678 (10 цифр — без кода страны)

    let normalized;
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
        normalized = '+7' + digits.slice(1);
    } else if (digits.length === 10) {
        normalized = '+7' + digits;
    } else {
        return { ok: false, error: 'invalid_phone_format' };
    }

    // Проверяем что после +7 идёт разумный оператор:
    // Мобильные казахстанские: 70X, 71X, 72X, 73X, 74X, 75X, 76X, 77X, 78X
    // Городские: 71X, 72X (частично пересекаются)
    // Ограничимся проверкой что первая цифра после +7 — 7 (мобильные) или 6 (городские южного региона)
    const afterPrefix = normalized.slice(2, 3);
    if (!['6', '7'].includes(afterPrefix)) {
        return { ok: false, error: 'invalid_phone_prefix' };
    }

    return { ok: true, phone: normalized };
}

// Валидация имени
export function validateName(input) {
    if (!input || typeof input !== 'string') {
        return { ok: false, error: 'name_required' };
    }
    const trimmed = input.trim();
    if (trimmed.length < 2) return { ok: false, error: 'name_too_short' };
    if (trimmed.length > 100) return { ok: false, error: 'name_too_long' };
    // Простая проверка что не только знаки препинания/цифры
    if (!/[а-яёА-ЯЁa-zA-Z]/.test(trimmed)) {
        return { ok: false, error: 'name_no_letters' };
    }
    return { ok: true, name: trimmed };
}

// Валидация текстового поля с ограничением длины
export function validateText(input, maxLen = 500) {
    if (input == null) return { ok: true, text: null };
    if (typeof input !== 'string') return { ok: false, error: 'invalid_text' };
    const trimmed = input.trim();
    if (trimmed.length > maxLen) return { ok: false, error: 'text_too_long' };
    return { ok: true, text: trimmed || null };
}
