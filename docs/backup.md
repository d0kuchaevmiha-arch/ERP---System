# Резервное копирование

На локальном Compose: `docker compose exec -T db pg_dump -U postgres -Fc app_db > backup.dump`. Проверка восстановления **только на отдельной тестовой базе**: `createdb test_restore` и `pg_restore --no-owner --dbname=test_restore backup.dump` при доступном PostgreSQL. Для production храните зашифрованные копии вне узла, настройте расписание (cron/systemd timer), retention и регулярную проверку восстановления. Автоматическая задача backup пока не поставляется.
