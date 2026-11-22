#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-$project_root/dist/TiceCDI-PHP.zip}"
mkdir -p "$(dirname -- "$output")"
output="$(cd -- "$(dirname -- "$output")" && pwd)/$(basename -- "$output")"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

install_dir="$work/Gestion-CDI-PHP"
mkdir -p "$install_dir/drizzle"
cp "$project_root/php/index.php" "$project_root/php/config.example.php" "$project_root/php/.htaccess" "$install_dir/"
cp -R "$project_root/php/app" "$project_root/public/cdi" "$install_dir/"
cp "$project_root"/drizzle/*.sql "$install_dir/drizzle/"
cp "$project_root/LICENSE" "$install_dir/"
cp "$project_root/docs/INSTALLATION-PHP.md" "$install_dir/INSTALLATION.md"
printf 'Require all denied\n' > "$install_dir/drizzle/.htaccess"

(cd "$work" && zip -q -r TiceCDI-PHP.zip Gestion-CDI-PHP)
mv -f -- "$work/TiceCDI-PHP.zip" "$output"
unzip -tq "$output"
