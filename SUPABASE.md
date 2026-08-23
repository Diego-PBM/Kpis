# Conexión GitHub ↔ Supabase

Este documento describe cómo queda conectado este repositorio (`diego-pbm/kpis`) con Supabase.

## 1. Integración nativa (recomendada)

Se configura desde el dashboard de Supabase, no desde el repositorio:

1. Entra a tu proyecto en [supabase.com/dashboard](https://supabase.com/dashboard).
2. Ve a **Project Settings → Integrations → GitHub → Connect to GitHub**.
3. Autoriza la GitHub App **Supabase** para el repositorio `diego-pbm/kpis`.
4. Selecciona:
   - Repositorio: `diego-pbm/kpis`
   - Rama de producción: `main`
   - (Opcional) **Branching automático**: crea una rama/BD de Supabase por cada Pull Request.
5. Guarda. A partir de aquí, cada push a `main` que modifique `supabase/migrations/` se despliega automáticamente.

## 2. Estructura del repositorio

- `supabase/config.toml` — configuración del proyecto (CLI/local dev).
- `supabase/migrations/` — carpeta de migraciones SQL. Vacía por ahora; añade aquí los archivos generados con `supabase migration new <nombre>`.

## 3. GitHub Action de respaldo

`.github/workflows/supabase-migrations.yml` aplica las migraciones con la CLI de Supabase (`supabase db push`) en cada push a `main` que toque `supabase/migrations/`. Es un respaldo opcional a la integración nativa — útil si prefieres control explícito vía Actions o si la integración del dashboard no está activa.

Requiere estos **secrets** en el repositorio (Settings → Secrets and variables → Actions):

| Secret | Dónde obtenerlo |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_PASSWORD` | Contraseña de la base de datos del proyecto |
| `SUPABASE_PROJECT_ID` | Project Settings → General → Reference ID |

## 4. Vincular el proyecto localmente (opcional)

```bash
supabase login
supabase link --project-ref <tu-project-ref>
```

Esto actualiza `project_id` en `supabase/config.toml` y permite ejecutar `supabase db push` / `supabase db pull` en local.
