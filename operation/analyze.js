const fs = require("fs-extra");

function addToCategories (categories, data) {
    let catalog = data[0].name;
    data.splice(0, 1);
    data.forEach(item => {
        let match = categories.find(m_item => m_item.name == item.name);
        if (!match) {
            categories.push({
                name: item.name,
                ids: [{
                    id: item.id,
                    catalogs: [catalog]
                }]
            })
        } else {
            let id_match = match.ids.find(m_item => m_item.id == item.id);
            if (id_match) {
                id_match.catalogs.push(catalog);
                id_match.catalogs.sort((a, b) => b - a);
            } else {
                match.ids.push({
                    id: item.id,
                    catalogs: [catalog]
                })
            }
        }
    })
}

async function analyze () {
    let apac = await fs.readFile("./storefront/categoryId_Name_mapping_apac.json", "utf8");
    let asia = await fs.readFile("./storefront/categoryId_Name_mapping_asia.json", "utf8");
    let eu = await fs.readFile("./storefront/categoryId_Name_mapping_eu.json", "utf8");
    let na = await fs.readFile("./storefront/categoryId_Name_mapping_na.json", "utf8");
    apac = JSON.parse(apac);
    asia = JSON.parse(asia);
    eu = JSON.parse(eu);
    na = JSON.parse(na);
    let categories = [];
    addToCategories(categories, apac);
    addToCategories(categories, asia);
    addToCategories(categories, eu);
    addToCategories(categories, na);
    await fs.writeJson("./storefront/all_locale_mapping.json", categories);
}

async function writeCSV () {
    let data = await fs.readJSON("./storefront/all_locale_mapping.json");
    let csv = "ord,name, id, catalogs\n";
    data.forEach((name_item, name_index) => {
        name_item.ids.forEach((id_item, id_index) => {
            id_item.catalogs.forEach((cat_item, cat_index) => {
                if (id_index == 0 && cat_index == 0) {
                    csv += `${name_index + 1},${name_item.name == "" ? "name_empty" : name_item.name},${id_item.id},"${cat_item}`;
                } else if (cat_index == 0) {
                    csv += `,,${id_item.id},"${cat_item}`;
                } else if (cat_index > 0) {
                    csv += `\n${cat_item}`;
                }
                if (cat_index == (id_item.catalogs.length - 1)) {
                    csv += `"\n`;
                }
            })
        })
    });
    await fs.writeFile("./storefront/all_locale_mapping.csv", csv);
}

async function writeConfigFile () {
    let data = await fs.readFile("./storefront/all_locale_mapping.json", "utf8");
    data = JSON.parse(data);
    let config = {};
    data.forEach(name_item => {
        if (name_item.name && name_item.name.length > 0) {
            let category_ids = [];
            name_item.ids.forEach(id_item => {
                if (
                    id_item.id &&
                    id_item.id.length > 0 &&
                    !/_nz$/.test(id_item.id.toLowerCase()) &&
                    !/-nz$/.test(id_item.id.toLowerCase())
                ) {
                    category_ids.push(id_item.id)
                } else {
                    console.log("skipping ", id_item.id)
                }
            })
            if (category_ids.length > 0) {
                config[name_item.name] = category_ids;
            } else {
                console.log("skipping xxx ", name_item);
            }
        } else {
            console.log("skipping ", name_item);
        }
    });
    await fs.writeJSON("./storefront/final_config.json", config);
}

writeConfigFile();