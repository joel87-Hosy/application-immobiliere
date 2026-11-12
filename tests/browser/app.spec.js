import { test,expect } from '@playwright/test';
test('dashboard, creation, persistence, filters, reports and roles',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Vue d’ensemble',exact:true})).toBeVisible();
 await page.screenshot({path:'docs/screenshots/dashboard-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Ajouter un bien',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Nom du bien').fill('Résidence Test Abidjan');await dialog.getByLabel('Commune / quartier').fill('Cocody');await dialog.getByLabel('Loyer mensuel').fill('180000');await dialog.getByRole('button',{name:'Enregistrer'}).click();await expect(dialog).not.toBeVisible();
 await page.getByRole('button',{name:'Biens immobiliers',exact:true}).click();await page.getByRole('textbox',{name:'Rechercher un bien, une commune…'}).fill('Résidence Test');await expect(page.getByRole('heading',{name:'Résidence Test Abidjan'})).toBeVisible();await expect(page.locator('.property-card')).toHaveCount(1);
 await page.reload();await page.getByRole('button',{name:'Biens immobiliers',exact:true}).click();await expect(page.getByRole('heading',{name:'Résidence Test Abidjan'})).toBeVisible();
 await page.getByRole('button',{name:'Rapports financiers',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/rapport-.*\.csv/);
 await page.getByLabel('Prévisualiser un rôle').selectOption('owner');await expect(page.getByRole('button',{name:'Ajouter un bien',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Biens immobiliers',exact:true}).click();await expect(page.locator('.property-card')).toHaveCount(4);
 await page.getByLabel('Prévisualiser un rôle').selectOption('tenant');await expect(page.getByRole('button',{name:'Locataires',exact:true})).toHaveCount(0);await page.getByRole('button',{name:/Maintenance/}).click();await page.getByRole('button',{name:'Nouvelle demande'}).click();await page.getByLabel('Objet de la demande').fill('Robinet à réparer');await page.getByLabel('Description',{exact:true}).fill('Le robinet du séjour est bloqué.');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Robinet à réparer'})).toBeVisible();
 expect(errors).toEqual([]);
});
test('mobile navigation, modal focus and responsive layout',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:'Vue d’ensemble',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/dashboard-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Ouvrir le menu'}).click();await page.getByRole('button',{name:'Locataires',exact:true}).click();await expect(page.getByRole('heading',{name:'Locataires',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Ajouter un locataire',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
