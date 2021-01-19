const mysqlutil = require("./utils/mysql");
const fs = require("fs-extra");

const productSelectedFields = [
    "attribute_code",
    "product_id",
    "entity_id",
    "sku",
    "type_id",
    "attribute_id",
    "value",
    "frontend_input",
    "frontend_label"
];
const productInheritFields = ["product_id", "type_id"];
const productEntityInheritFields = ["product_id", "entity_id", "type_id"];
const attributeInheritFields = ["attribute_id", "value", "label", "html_type", "data_type", "validation", "is_super", "is_system", "unit"];
const multivalueAttributes = ["multiselect", "multiinput"];

var executes = [
    'schema_init.txt',
    'data_product_eav.txt',
    // 'data_product_eav_datetime.txt',
    'data_product_category_assignment.txt',
    'data_product_eav_decimal.txt',
    'data_product_eav_int.txt',
    'data_product_eav_multi_value.txt',
    'data_product_eav_text.txt',
    'data_product_eav_varchar.txt',
    'data_product_entity.txt',
    'data_category_entity.txt'
];

var sqlDBConfig = {
    host: "localhost",
    port: "3306",
    user: "root",
    password: "tkh170294"
}

function centralizeAttributeMetaData (products) {
    let data = {
        attributes: []
    };
    function extracting (product) {
        if(!product.attributes) return;
        product.attributes.forEach((attribute, index) => {
            let match = data.attributes.find(item => item.attribute_id == attribute.attribute_id);
            if(!match) {
                match = {};
                Object.assign(match, attribute);
                delete match.value;
                data.attributes.push(match);
            }
            product.attributes[index] = {
                attribute_code: attribute.attribute_code,
                value: attribute.value
            }
        })
    }
    products.forEach(product => {
        if(product.parent){
            extracting(product.parent);
        }
        if(product.self){
            extracting(product.self)
        }
        if(product.variants){
            product.variants.forEach(variant => {
                extracting(variant);
            })
        }
    });
    data.products = products;
    return data;
}

async function buildProductEavIndex () {
    const DB = await mysqlutil.generateConnection(sqlDBConfig);
    let truncate = await DB.promiseQuery(`TRUNCATE TABLE \`ecommerce\`.product_eav_index`);
    console.log("truncate table product_eav_index: ", truncate);
    let rawData = await selectProductsData();
    let products = modelizeProductsData(rawData);
    let product_eav_index = mysqlutil.buildProductEavIndexJson(products);
    if (product_eav_index && product_eav_index.length > 0) {
        let sql =
        `
        INSERT INTO \`ecommerce\`.product_eav_index (entity_id, product_id, attribute_id, value)
        VALUES ${product_eav_index.map(eav => `('${mysqlutil.escapeQuotes(eav.entity_id)}', '${mysqlutil.escapeQuotes(eav.product_id)}', '${mysqlutil.escapeQuotes(eav.attribute_id)}', '${mysqlutil.escapeQuotes(eav.value)}')`).join(", ")}
        `;
        let result = await DB.promiseQuery(sql);
        console.log("build product_eav_index success: ", result);
    };
    DB.end();
}

async function initEcommerceDB ()  {
    try {
        let start = Date.now()
        const DB = await mysqlutil.generateConnection(sqlDBConfig);
        let sqls = [];
        for (let i = 0; i < executes.length; i++) {
            let fileData = await fs.readFile(`../${executes[i]}`, "utf-8");
            fileData = fileData.split(/\n###.*|^###.*/);
            fileData.forEach(sql => {
                sql = sql.trim();
                if (sql.length > 0) sqls.push(sql);
            })
        }
        for (let i = 0; i < sqls.length; i++) {
            await DB.promiseQuery(sqls[i]);
        }
        await buildProductEavIndex();
        let end = Date.now();
        console.log("DB init took ", end - start, " ms");
        DB.end();
    } catch (error) {
        throw error;
    }
}

async function selectProductsData (entity_ids) {
    try {
        const DB = await mysqlutil.generateConnection(sqlDBConfig);
        await DB.promiseQuery("USE `ecommerce`;");
        let entity_query = '';
        if (entity_ids && entity_ids.length > 0) {
            entity_query = entity_ids.map(item => `'${mysqlutil.escapeQuotes(item)}'`).join(', ');
            entity_query = `WHERE \`pe\`.entity_id IN (${entity_query}) OR \`pe\`.parent IN (${entity_query})`;
        }
        let query = `SELECT \`pe\`.entity_id, \`pe\`.product_id, \`pe\`.type_id, \`pe\`.value, \`attributes\`.*  FROM (
            SELECT
                \`pe\`.entity_id, IF((\`pe\`.parent is not null and \`pe\`.parent != \'\'), \`pe\`.parent, \`pe\`.entity_id) as product_id,
                \`pe\`.type_id, \`eav\`.attribute_id, \`eav\`.value
            FROM \`ecommerce\`.product_entity as \`pe\`
            LEFT JOIN \`ecommerce\`.product_eav_int as \`eav\` ON \`eav\`.entity_id = \`pe\`.entity_id
            ${entity_query}
            UNION
            SELECT
                \`pe\`.entity_id, IF((\`pe\`.parent is not null and \`pe\`.parent != \'\'), \`pe\`.parent, \`pe\`.entity_id) as product_id,
                \`pe\`.type_id, \`eav\`.attribute_id, \`eav\`.value
            FROM \`ecommerce\`.product_entity as \`pe\`
            LEFT JOIN \`ecommerce\`.product_eav_decimal as \`eav\` ON \`eav\`.entity_id = \`pe\`.entity_id
            ${entity_query}
            UNION
            SELECT
                \`pe\`.entity_id, IF((\`pe\`.parent is not null and \`pe\`.parent != \'\'), \`pe\`.parent, \`pe\`.entity_id) as product_id,
                \`pe\`.type_id, \`eav\`.attribute_id, \`eav\`.value
            FROM \`ecommerce\`.product_entity as \`pe\`
            LEFT JOIN \`ecommerce\`.product_eav_varchar as \`eav\` ON \`eav\`.entity_id = \`pe\`.entity_id
            ${entity_query}
            UNION
            SELECT
                \`pe\`.entity_id, IF((\`pe\`.parent is not null and \`pe\`.parent != \'\'), \`pe\`.parent, \`pe\`.entity_id) as product_id,
                \`pe\`.type_id, \`eav\`.attribute_id, \`eav\`.value
            FROM \`ecommerce\`.product_entity as \`pe\`
            LEFT JOIN \`ecommerce\`.product_eav_text as \`eav\` ON \`eav\`.entity_id = \`pe\`.entity_id
            ${entity_query}
            UNION
            SELECT
                \`pe\`.entity_id, IF((\`pe\`.parent is not null and \`pe\`.parent != \'\'), \`pe\`.parent, \`pe\`.entity_id) as product_id,
                \`pe\`.type_id, \`eav\`.attribute_id, \`eav\`.value
            FROM \`ecommerce\`.product_entity as \`pe\`
            LEFT JOIN \`ecommerce\`.product_eav_datetime as \`eav\` ON \`eav\`.entity_id = \`pe\`.entity_id
            ${entity_query}
            UNION
            SELECT
                \`pe\`.entity_id, IF((\`pe\`.parent is not null and \`pe\`.parent != \'\'), \`pe\`.parent, \`pe\`.entity_id) as product_id,
                \`pe\`.type_id, \`eav\`.attribute_id, \`eav\`.value
            FROM \`ecommerce\`.product_entity as \`pe\`
            LEFT JOIN \`ecommerce\`.product_eav_multi_value as \`eav\` ON \`eav\`.entity_id = \`pe\`.entity_id
            ${entity_query}
        ) as \`pe\`
        LEFT JOIN \`ecommerce\`.product_eav as \`attributes\` ON \`attributes\`.attribute_id = \`pe\`.attribute_id
        ORDER BY \`pe\`.product_id, \`pe\`.entity_id`;
        let start = Date.now();
        let result = await DB.promiseQuery(query);
        let end = Date.now();
        console.log("query took: ", end - start, " ms");
        // await fs.writeJSON("../test.json", result);
        DB.end();
        return result;
    } catch (error) {
        throw error;
    }
}

function modelizeProductsData (rawData) {
    try {
        console.log(rawData.length);
        let start = Date.now();
        let products = mysqlutil.groupByAttribute({
            rawData: rawData,
            groupBy: "product_id"
        });
        products.forEach((product, index) => {
            let self = product.__items.find(line_item => line_item.entity_id == product.product_id);
            if(!self){
                console.warn("Product ", product.product_id, " has no parent. Hence is ignored!");
                products[index] = null;
                return;
            }
            product.type_id = self.type_id;
            product.__items = mysqlutil.groupByAttribute({
                rawData: product.__items,
                groupBy: "entity_id"
            });
            switch (product.type_id) {
                case "simple": case "bundle": case "grouped": case "downloadable":
                    product.self = product.__items.find(line_item => line_item.entity_id == product.product_id);
                    break;
                case "master":
                    product.parent = product.__items.find(line_item => line_item.entity_id == product.product_id);
                    product.variants = product.__items.filter(line_item => line_item.entity_id != product.product_id);
                    break;
                default:
                    products[index] = null;
                    return;
            };
            product.__items.forEach(product_entity => {
                if(product_entity.__items[0]){
                    productEntityInheritFields.forEach(field_item => {
                        product_entity[field_item] = product_entity.__items[0][field_item] || product_entity[field_item];
                    })
                }
                product_entity.attributes = mysqlutil.groupByAttribute({
                    rawData: product_entity.__items,
                    groupBy: "attribute_id",
                    nullExcept: [null, ""]
                });
                product_entity.attributes.forEach(attr_item => {
                    if(attr_item.__items[0]){
                        if("__items" in attr_item.__items[0]){
                            throw new Error("Invalid property name \"__item\". \"__item\" is framework preserved key.")
                        }
                        attributeInheritFields.forEach(field_item => {
                            attr_item[field_item] = attr_item.__items[0][field_item] || attr_item[field_item];
                        })
                    }
                    if(multivalueAttributes.indexOf(attr_item.html_type) != -1){
                        attr_item.value = [];
                        attr_item.__items.forEach(value_item => {
                            attr_item.value.push(value_item.value);
                        })
                    }
                    delete attr_item.__items;
                });
                delete product_entity.__items;
            });
            delete product.__items;
        })
        products = products.filter(product => product != null);
        let end = Date.now();
        console.log("product processing took: ", end - start, " ms");
        return products;
    } catch (error) {
        throw error;
    }
}

async function getProductsDB () {
    let rawData = await selectProductsData(['PR001', 'PR002']);
    let products = modelizeProductsData(rawData);
    console.log(products);
    // await fs.writeJSON("../DBproducts.json", products);
}

async function getProductsCache () {
    let start = Date.now();
    let products = await fs.readFile("../test2.json", "utf8");
    products = JSON.parse(products);
    let end = Date.now();
    console.log("get products cache took ", end - start, " ms");
    console.log(products.length);
    fs.re
}

initEcommerceDB()

