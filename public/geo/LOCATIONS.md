# Справочник районов и городов SFMap

Справочник shared/locations.json содержит общие точки районов Москвы и городов Московской области. Зеленоград, Троицк и Щербинка представлены едиными городами. Точки предназначены для ориентирования на карте сообщества, не показывают адрес участника и не являются кадастровыми центрами.

## Районы Москвы

Источник геометрии: GIS-Lab / © участники OpenStreetMap, через [Click That ’Hood, moscow.geojson](https://github.com/codeforgermany/click_that_hood/blob/main/public/data/moscow.geojson). [Метаданные источника](https://github.com/codeforgermany/click_that_hood/blob/main/public/data/moscow.metadata.json) указывают GIS-Lab/OpenStreetMap, http://gis-lab.info/qa/osm-adm.html. Данные OpenStreetMap распространяются под [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); [атрибуция OpenStreetMap](https://www.openstreetmap.org/copyright).

Изменения: удалены отдельные районы Зеленограда; оставшимся присвоены стабильные ID и вычислены представительные точки внутри полигона. Сохранённая производная геометрия server/location-boundaries.json доступна в исходниках проекта на условиях ODbL. Исходные контуры датированы 2013 годом, применяются для переноса старых координат, не служат актуальным юридическим справочником границ.

Для Бекасово, Вороново, Коммунарки, Краснопахорского и Филимонковского добавлены условные центры. Внуково уже присутствует в исходном наборе. Троицк и Щербинка выбираются как города. Контуры Новой Москвы после реформы 2024 года не включены; при переносе старых точек вне сохранённых контуров используется ближайший центр Москвы.

## Города

Источник: [hflabs/city — Города России](https://github.com/hflabs/city), данные сервиса [DaData.ru](https://dadata.ru/). Названия, ФИАС-ID и координаты городов Московской области взяты из [city.csv](https://github.com/hflabs/city/blob/master/city.csv). Лицензия источника — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), согласно README источника.

Изменения: выбраны города Московской области, включая центры, представленные в CSV как area_type=г; координаты округлены до 5 знаков. Производная часть справочника городов распространяется под CC BY-SA 4.0. Зеленоград, Троицк и Щербинка добавлены отдельно как общие условные точки.

## Воспроизведение

Данные получены 11 ноября 2026 года. Скрипт scripts/build-locations.ts читает исходники из data/location-districts-source.json и data/location-cities-source.csv либо загружает их из указанных репозиториев, затем создаёт shared/locations.json и server/location-boundaries.json. Для запуска: node --import tsx scripts/build-locations.ts.
