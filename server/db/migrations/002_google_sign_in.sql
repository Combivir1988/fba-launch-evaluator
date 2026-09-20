-- spec 004: вход через Google по приглашению (см. specs/004-google-sign-in/plan.md)
-- Почта — то, что вписывает администратор (приглашение); google_sub — постоянный идентификатор аккаунта Google, привязывается при первом входе.
-- Пользователь без пароля хранит в password_hash значение '!' — оно не разбирается как scrypt-хэш, вход по паролю для него невозможен.

ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN google_sub text;
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;
