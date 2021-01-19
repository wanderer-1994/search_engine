const mysqlutil = require("./mysql");
const fulltextSearch = require("./fulltextSearch");

function createSearchQueryDB ({ categories, entity_ids, refinements, searchPhrase, searchDictionary }) {
    // ## search by category_id
    let queryCID = "";
    if (categories && categories.length > 0) {
        queryCID =
        `
        WITH RECURSIVE \`cte\` (entity_id) AS (
            SELECT entity_id
            FROM \`ecommerce\`.category_entity
            WHERE entity_id IN (\'${categories.map(item => mysqlutil.escapeQuotes(item)).join("\', \'")}\')
            UNION ALL
            SELECT p.entity_id
            FROM \`ecommerce\`.category_entity AS \`p\`
            INNER JOIN \`cte\` ON \`p\`.parent = \`cte\`.entity_id
        )
        SELECT product_id, MAX(weight) AS weight, \'category\' AS \`type\` FROM (
            SELECT
            IF(\`pe\`.parent IS NOT NULL AND \`pe\`.parent != '', \`pe\`.parent, \`pe\`.entity_id) AS product_id,
            IF(\`pca\`.position IS NOT NULL, 100 + \`pca\`.position, 100) AS \`weight\`
            FROM \`ecommerce\`.product_category_assignment AS \`pca\`
            INNER JOIN \`ecommerce\`.product_entity AS \`pe\` ON \`pe\`.entity_id = \`pca\`.product_id
            WHERE \`pca\`.category_id IN(SELECT DISTINCT entity_id FROM \`cte\`)
        ) as \`alias\`
        GROUP BY product_id
        `;
    }
    // ## search by entity_ids
    let queryPID = ""
    if (entity_ids && entity_ids.length > 0) {
        queryPID =
        `
        SELECT product_id, MAX(weight) AS weight, \'entity_id\' AS \`type\` FROM (
            SELECT IF(\`pe\`.parent IS NOT NULL AND \`pe\`.parent != '', \`pe\`.parent, \`pe\`.entity_id) AS product_id,
            1000 AS \`weight\`
            FROM \`ecommerce\`.\`product_entity\` AS \`pe\`
            WHERE \`pe\`.entity_id IN (\'${entity_ids.map(item => mysqlutil.escapeQuotes(item)).join("\', \'")}\')
        ) AS \`alias\`
        GROUP BY product_id
        `;
    }
    // ## search by attribute refinements
    let queryRefinement = "";
    if (refinements && refinements.length > 0) {
        let refinementComponentQueries = refinements.map(item => {
            return `(\`attribute_id\`='${mysqlutil.escapeQuotes(item.attribute_id)}' AND \`value\` IN ('${item.value.map(item => mysqlutil.escapeQuotes(item.toString())).join("\', \'")}'))`
        }).join(" OR ");
        
        queryRefinement =
        `
        SELECT product_id, 10*${refinements.length} AS \`weight\`, \'attribute\' AS \`type\` FROM
        (   SELECT product_id, GROUP_CONCAT(attribute_id) AS attribute_ids FROM
            (   SELECT \`eav\`.product_id, \`eav\`.attribute_id
                FROM \`ecommerce\`.\`product_eav_index\` AS \`eav\`
                WHERE ${refinementComponentQueries}
            ) AS \`alias\` GROUP BY product_id
        ) AS \`alias2\`
        WHERE (${refinements.map(item => `FIND_IN_SET('${mysqlutil.escapeQuotes(item.attribute_id)}', \`alias2\`.attribute_ids)`).join(" AND ")})
        `;
    }
    // ## search by search phrase
    let querySearchPhrase = "";
    if (searchPhrase) {
        querySearchPhrase = fulltextSearch.generateFulltextSqlSearchProductEntity({ searchPhrase, searchDictionary });
    }
    // ## final assembled search query
    let assembledQuery = [queryCID, queryPID, queryRefinement, querySearchPhrase]
    .filter(item => (item != null && item != ""));
    
    if (assembledQuery.length == 0) {
        assembledQuery = 
        `
        SELECT entity_id AS product_id, 1 AS \`weight\`, 'all' AS \`type\`
        FROM \`ecommerce\`.product_entity WHERE parent IS NULL OR parent = ''
        `;
    } else {
        assembledQuery = assembledQuery.join(" UNION ALL ")
    }

    return assembledQuery;
};

function searchConfigValidation ({ categories, entity_ids, refinements, searchPhrase }) {
    try {
        let required = [];
        if (categories && Array.isArray(categories) && categories.length > 0) {
            categories.forEach(item => {
                if (typeof(item) != "string" || item.length == 0)
                    throw new Error("Search config invalid: categories must be a list of none-empty string!");
            });
            required.push("category");
        } else if (categories && !Array.isArray(categories)) {
            throw new Error("Search config invalid: categories must be an array!");
        }
        if (entity_ids && Array.isArray(entity_ids) && entity_ids.length > 0) {
            entity_ids.forEach(item => {
                if (typeof(item) != "string" || item.length == 0)
                    throw new Error("Search config invalid: entity_ids must be a list of none-empty string!");
            });
            required.push("entity_id");
        } else if (entity_ids && !Array.isArray(entity_ids)) {
            throw new Error("Search config invalid: entity_ids must be an array!");
        }
        if (refinements && Array.isArray(refinements) && refinements.length > 0) {
            refinements.forEach(item => {
                if (typeof(item.attribute_id) != "string" || item.attribute_id.length == 0)
                    throw new Error("Search config invalid: refinement attribute_id must be a none-empty string!");
                if (!Array.isArray(item.value) || item.value.length == 0)
                    throw new Error("Search config invalid: refinement value must be a none-empty list!");
                item.value.forEach(value => {
                    if (typeof(value) != "number" && typeof(value) != "string")
                        throw new Error("Search config invalid: refinement value must be a list of string or number!")
                })
            });
            required.push("attribute");
        } else if (refinements && !Array.isArray(refinements)) {
            throw new Error("Search config invalid: refinements must be an array!")
        }
        if (
            (searchPhrase != null && typeof(searchPhrase) != "string") ||
            (typeof(searchPhrase) == "string" && searchPhrase.trim().length == 0)
        ) {
            throw new Error("Search config invalid: searchPhrase must be none-empty string!")
        } else if (searchPhrase) {
            required.push("name");
        };
        return required;
    } catch (err) {
        throw err
    }
}

async function searchByCategories ({ categories, DB }) {
    try {
        if (!categories || categories.length < 1) return null;
        let queryCID =
        `
        WITH RECURSIVE \`cte\` (entity_id) AS (
            SELECT entity_id
            FROM \`ecommerce\`.category_entity
            WHERE entity_id IN (\'${categories.map(item => mysqlutil.escapeQuotes(item)).join("\', \'")}\')
            UNION ALL
            SELECT p.entity_id
            FROM \`ecommerce\`.category_entity AS \`p\`
            INNER JOIN \`cte\` ON \`p\`.parent = \`cte\`.entity_id
        )
        SELECT product_id, MAX(weight) AS weight, \'category\' AS \`type\` FROM (
            SELECT
            IF(\`pe\`.parent IS NOT NULL AND \`pe\`.parent != '', \`pe\`.parent, \`pe\`.entity_id) AS product_id,
            IF(\`pca\`.position IS NOT NULL, 100 + \`pca\`.position, 100) AS \`weight\`
            FROM \`ecommerce\`.product_category_assignment AS \`pca\`
            INNER JOIN \`ecommerce\`.product_entity AS \`pe\` ON \`pe\`.entity_id = \`pca\`.product_id
            WHERE \`pca\`.category_id IN(SELECT DISTINCT entity_id FROM \`cte\`)
        ) as \`alias\`
        GROUP BY product_id
        `;
        let products = await DB.promiseQuery(queryCID);
        return products;
    } catch (err) {
        throw err;
    }
}

async function searchByEntityIds ({ entity_ids, DB }) {
    try {
        if (!entity_ids || entity_ids.length < 1) return null;
        let queryPID =
        `
        SELECT product_id, MAX(weight) AS weight, \'entity_id\' AS \`type\` FROM (
            SELECT IF(\`pe\`.parent IS NOT NULL AND \`pe\`.parent != '', \`pe\`.parent, \`pe\`.entity_id) AS product_id,
            1000 AS \`weight\`
            FROM \`ecommerce\`.\`product_entity\` AS \`pe\`
            WHERE \`pe\`.entity_id IN (\'${entity_ids.map(item => mysqlutil.escapeQuotes(item)).join("\', \'")}\')
        ) AS \`alias\`
        GROUP BY product_id
        `;
        let products = await DB.promiseQuery(queryPID);
        return products;
    } catch (err) {
        throw err;
    }
}

async function searchByRefinements ({ refinements, DB }) {
    try {
        if (!refinements || refinements.length < 1) return null;
        let refinementComponentQueries = refinements.map(item => {
            return `(\`attribute_id\`='${mysqlutil.escapeQuotes(item.attribute_id)}' AND \`value\` IN ('${item.value.map(item => mysqlutil.escapeQuotes(item.toString())).join("\', \'")}'))`
        }).join(" OR ");
        
        queryRefinement =
        `
        SELECT product_id, 10*${refinements.length} AS \`weight\`, \'attribute\' AS \`type\` FROM
        (   SELECT product_id, GROUP_CONCAT(attribute_id) AS attribute_ids FROM
            (   SELECT \`eav\`.product_id, \`eav\`.attribute_id
                FROM \`ecommerce\`.\`product_eav_index\` AS \`eav\`
                WHERE ${refinementComponentQueries}
            ) AS \`alias\` GROUP BY product_id
        ) AS \`alias2\`
        WHERE (${refinements.map(item => `FIND_IN_SET('${mysqlutil.escapeQuotes(item.attribute_id)}', \`alias2\`.attribute_ids)`).join(" AND ")})
        `;
        let products = await DB.promiseQuery(queryRefinement);
        return products;
    } catch (err) {
        throw err;
    }
}

async function searchBySearchPhrase ({ searchPhrase, searchDictionary, DB }) {
    try {
        if (!searchPhrase || searchPhrase.length < 1) return null;
        let querySearchPhrase = fulltextSearch.generateFulltextSqlSearchProductEntity({ searchPhrase, searchDictionary });
        let entities = await DB.promiseQuery(querySearchPhrase);
        return entities;
    } catch (err) {
        throw err;
    }
}

function finalFilterProductEntities ({ products, required }) {
    for (let i = 0; i < products.length; i++) {
        let product = products[i];
        let isPassed = true;
        for (let j = 0; j < required.length; j++) {
            let match = product.__items.find(search_type => search_type.type == required[j]);
            if (!match) {
                isPassed= false;
                break;
            }
        };
        if (!isPassed) {
            products.splice(i, 1);
            i -= 1;
        };
    };
    return products;
}

function sortProductsBySignificantWeight (products) {
    products.forEach(product => {
        product.weight = 0;
        product.__items.forEach(search_type => {
            product.weight += search_type.weight;
        });
        delete product.__items;
    })
    products.sort((a, b) => {
        return b.weight - a.weight;
    });
    return products;
};

module.exports = {
    createSearchQueryDB,
    finalFilterProductEntities,
    sortProductsBySignificantWeight,
    searchConfigValidation,
    searchByCategories,
    searchByEntityIds,
    searchByRefinements,
    searchBySearchPhrase
}