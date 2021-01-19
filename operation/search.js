const mysqlutil = require("./utils/mysql");
const searchutils = require("./utils/search");

var sqlDBConfig = {
    host: "localhost",
    port: "3306",
    user: "root",
    password: "tkh170294"
}

async function searchDB ({ categories, entity_ids, refinements, searchPhrase, searchDictionary, page }) {
    let required = searchutils.searchConfigValidation({ categories, entity_ids, refinements, searchPhrase });
    const DB = await mysqlutil.generateConnection(sqlDBConfig);
    let start = Date.now();
    if (refinements && refinements.length > 0) {
        // validate refinements contains searchable attributes only
        let product_eav = await DB.promiseQuery(`SELECT * FROM \`ecommerce\`.product_eav`);
        refinements.forEach(item => {
            let match = product_eav.find(m_item => m_item.attribute_id == item.attribute_id);
            if (!match) {
                console.warn(`Search refinements contains unknown attribute_id=${item.attribute_id}, which could results in wrong search result!`);
            }
            if (match && !mysqlutil.isAttributeSearchable(match)) {
                console.warn(`Search refinements contains not searchable attribute_id=${item.attribute_id}, which could results in wrong search result!`);
            }
        })
    }

    let assembledQuery = searchutils.createSearchQueryDB({ categories, entity_ids, refinements, searchPhrase, searchDictionary });
    let rowData = await DB.promiseQuery(assembledQuery);
    let end = Date.now();
    console.log("search query took: ", end - start, " ms");
    let products = mysqlutil.groupByAttribute({
        rawData: rowData,
        groupBy: "product_id"
    })
    products = searchutils.finalFilterProductEntities({ products, required });
    products = searchutils.sortProductsBySignificantWeight(products);
    end = Date.now();
    console.log("search query took: ", end - start, " ms");
    DB.end();
    return products;
};

let searchConfigDB = {
    "categories": ["earbud", "charge_cable"],
    "entity_ids": ["PR001", "PR003", "PR004"],
    "refinements": [
    {
        "attribute_id": "color",
        "value": ["Đỏ_#eb3458", "Lam_#eb3458"]
    }],
    "searchPhrase": "true wireless earbud",
    "searchDictionary": {
        "synonyms": [["SẠC DỰ PHÒNG", "POWERBANK", "PIN DỰ PHÒNG"], ["CÁP SẠC", "DÂY SẠC"], ["IPHONE", "LIGHTNING"], ["ANDROID", "SAMSUNG"]]
    },
    "page": 2
};

(async () => {
    let data = await searchDB(searchConfigDB);
    console.log(JSON.stringify(data, null, "  "));
})()
