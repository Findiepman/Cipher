/**
 * Nederlands.
 *
 * Keyed against `en.ts`, so `tsc` will not let this file invent a key, and a
 * key it does not carry falls back to English rather than rendering blank.
 *
 * On the security words, which i18n-plan.md flags as the one place a careless
 * translation would make the app claim more than it can back. The English uses
 * four words and means four different things by them, so the Dutch does too:
 *
 *   sealed     verzegeld     closed with a key, said of a message or a note
 *   encrypted  versleuteld   the same thing, said plainly, where the English
 *                            is being plain
 *   locked     vergrendeld   shut but present, said of the app and the vault
 *   wrapped    ingepakt      a key inside another key's box
 *
 * `verzegeld` is the slightly unusual choice of the four. It is deliberate:
 * the English says "sealed" in the places where it is describing what happens
 * to an envelope rather than making a claim about cryptography, and collapsing
 * both onto `versleuteld` would quietly upgrade the promise.
 *
 * House style here is Dutch house style. The no em dash rule carries over
 * because it is about plainness, and the rest of the English punctuation
 * conventions do not.
 */
import type { Key } from './en';
import type { Catalogue } from './translate';

export const nl: Catalogue<Key> = {
  /* --- gedeeld ---------------------------------------------------------- */

  'common.cancel': 'Annuleren',
  'common.save': 'Opslaan',
  'common.close': 'Sluiten',
  'common.remove': 'Weghalen',
  'common.delete': 'Verwijderen',
  'common.wrong': 'Er ging iets mis.',
  'common.unknown': 'onbekend',
  'common.today': 'vandaag',
  'common.yesterday': 'gisteren',

  /* --- instellingen ----------------------------------------------------- */

  'settings.nav': 'Onderdelen van instellingen',
  'settings.back': 'Instellingen',
  'settings.close': 'Instellingen sluiten',
  'account.you':
    'Jij',
  'account.editProfile':
    'Profiel bewerken',
  'settings.lock': 'Vergrendelen',
  'settings.signOut': 'Uitloggen',
  'settings.group.you': 'jij',
  'settings.group.app': 'app',

  'settings.section.account': 'Mijn account',
  'settings.lede.account':
    'Je inloggegevens, en de twee die alleen te wijzigen zijn op een apparaat dat je sleutel heeft.',
  'settings.section.profile': 'Profiel',
  'settings.lede.profile': 'De foto, de banner, de naam en wat je over jezelf vertelt.',
  'settings.section.privacy': 'Privacy',
  'settings.lede.privacy':
    'Wat mensen over je kunnen zien zodra de berichten zelf verzegeld zijn.',
  'settings.section.devices': 'Apparaten en sleutels',
  'settings.lede.devices':
    'Je beveiligingsnummer, je herstelcode en overal waar je bent ingelogd.',
  'settings.section.vault': 'Kluis',
  'settings.lede.vault':
    'De toegangscode die je eigen ruimte opent, en de enige manier om hem kwijt te raken.',
  'settings.section.language': 'Taal',
  'settings.lede.language': 'In welke taal de app tegen je praat.',
  'settings.section.appearance': 'Weergave',
  'settings.lede.appearance':
    'Hoe de app eruitziet en hoeveel ruimte hij een gesprek geeft.',
  'settings.section.voice': 'Spraak en video',
  'settings.lede.voice':
    'Welke apparatuur een gesprek zou gebruiken, en een manier om te controleren of dat werkt voordat er een begint.',
  'settings.section.notifications': 'Meldingen',
  'settings.lede.notifications':
    'Wat je onderbreekt, en hoeveel van een bericht het mag laten zien.',
  'settings.section.desktop': 'Desktop',
  'settings.lede.desktop':
    'De app om de app heen: updates, het systeemvak en starten met je computer.',

  /* --- taal ------------------------------------------------------------- */

  'language.group': 'taal',
  'language.pick': 'Taal',
  'language.pickHint':
    'Datums en tijden gaan mee. Wat mensen je geschreven hebben niet: hun woorden blijven staan zoals zij ze schreven.',
  'language.system': 'Volg mijn browser',
  'language.systemHint': 'Nu {name}.',
  'language.note':
    'Je taal blijft op dit apparaat, net als elke andere voorkeur hier. De server krijgt niet te horen welke je koos, om dezelfde reden dat hij verder niets over je te horen krijgt.',

  /* --- privacy ---------------------------------------------------------- */

  'privacy.group.reveal': 'wat je prijsgeeft',
  'privacy.readReceipts': 'Leesbevestigingen',
  'privacy.readReceiptsHint':
    'Laat de ander zien wanneer je zijn bericht hebt geopend. Uit betekent dat de server het niet meer doorgeeft; je eigen apparaten houden de telling wel bij.',
  'privacy.typing': 'Typmelding',
  'privacy.typingHint':
    'Laat de ander zien dat je iets aan het schrijven bent, ook de concepten die je weer weghaalt. Uit betekent dat dit apparaat het gewoon nooit zegt.',
  'privacy.group.reach': 'wie je kan bereiken',
  'privacy.requestsFrom': 'Vriendschapsverzoeken van',
  'privacy.requestsHint':
    'Berichten komen al alleen van vrienden. Dit gaat over wie het mag vragen. Wie buiten de keuze valt krijgt te horen dat je niet bestaat.',
  'privacy.requests.everyone': 'Iedereen',
  'privacy.requests.friendsOfFriends': 'Vrienden van vrienden',
  'privacy.requests.nobody': 'Niemand',
  'privacy.note':
    'Hier verandert niets aan wat de server van je berichten kan lezen, en dat is niets. Twee van deze keuzes staan op de server, omdat het de server is die anders een leesbevestiging doorgeeft of een verzoek doorlaat.',

  /* --- de kluis --------------------------------------------------------- */

  'vault.kind.digits': 'Cijfers',
  'vault.kind.digitsHint': 'Een pincode. Snel te typen, en de kortste van de twee.',
  'vault.kind.mixed': 'Letters en cijfers',
  'vault.kind.mixedHint': 'Langer te typen, en veel moeilijker te raden.',

  'vault.problem.minDigits': 'Gebruik minstens {min} cijfers.',
  'vault.problem.minChars': 'Gebruik minstens {min} tekens.',
  'vault.problem.maxDigits': 'Gebruik hoogstens {max} cijfers.',
  'vault.problem.maxChars': 'Gebruik hoogstens {max} tekens.',
  'vault.problem.digitsOnly': 'Alleen cijfers, geen letters.',
  'vault.problem.alnumOnly': 'Alleen letters en cijfers.',
  'vault.problem.repeated': 'Dat is steeds hetzelfde teken.',
  'vault.problem.sequence': 'Dat is een rechte reeks tekens.',

  'vault.combos.none': 'nog geen',
  'vault.combos.thousand': 'ongeveer {count} duizend combinaties',
  'vault.combos.million': 'ongeveer {count} miljoen combinaties',
  // Niet 'biljoen'. Het Engelse 'billion' is 10^9, en dat heet in het
  // Nederlands een miljard. Een biljoen is duizend keer zo groot, en dat zou
  // hier een getal beloven dat de app niet waarmaakt.
  'vault.combos.billion': 'ongeveer {count} miljard combinaties',
  'vault.combos.beyond': 'meer combinaties dan iemand ooit doorloopt',

  'vault.title': 'Kluis',
  'vault.field.passkey': 'Toegangscode',
  'vault.field.passkeyAgain': 'Toegangscode nogmaals',
  'vault.field.password': 'Je accountwachtwoord',

  'vault.setup.title': 'Een kluis maken',
  'vault.setup.lede':
    'Ergens om je eigen dingen te bewaren. Verzegeld met een sleutel die alleen jouw toegangscode opent, zodat hij dicht blijft ook terwijl je bent ingelogd.',
  'vault.setup.kind': 'Soort toegangscode',
  'vault.setup.note':
    'Nu eenmalig gevraagd, zodat je de toegangscode kunt vergeten zonder alles kwijt te zijn: dezelfde kluissleutel wordt een tweede keer verzegeld onder je wachtwoord, en geen van beide zegels opent het andere. Hier gaat niets naar de server.',
  'vault.setup.mismatch': 'De twee toegangscodes zijn niet gelijk.',
  'vault.setup.sealing': 'Verzegelen\u2026',
  'vault.setup.go': 'Maak de kluis',

  'vault.unlock.lede': 'Vergrendeld. {kind}, zoals je hem instelde.',
  'vault.unlock.forgotLede':
    'Je accountwachtwoord opent hem ook. Daarna kun je bij Instellingen een nieuwe toegangscode kiezen.',
  'vault.unlock.opening': 'Openen\u2026',
  'vault.unlock.go': 'Openen',
  'vault.unlock.forgot': 'Ik ben de toegangscode vergeten',
  'vault.unlock.usePasskey': 'Toch de toegangscode gebruiken',

  'vault.open.empty': 'Leeg. Wat je hier schrijft blijft op dit apparaat.',
  'vault.open.count': {
    one: '{count} notitie, op dit apparaat',
    other: '{count} notities, op dit apparaat',
  },
  'vault.open.lock': 'Vergrendelen',
  'vault.open.blank':
    'Notities aan jezelf, een nummer dat je steeds vergeet, dat ene dat je niet in een gesprek wilde zetten. Foto\u2019s komen later.',
  'vault.open.deleteNote': 'Deze notitie verwijderen',
  'vault.open.composer': 'bewaar iets',

  'vault.error.noVault': 'Er is nog geen kluis op dit apparaat.',
  'vault.error.wrongSecret': 'Deze sleutel liet zich niet openen met wat je invulde.',
  'vault.error.wrongPassword': 'Dat is niet je accountwachtwoord.',
  'vault.error.generic': 'Dat werkte niet. Probeer het opnieuw.',

  'vault.settings.absent': 'Geen kluis op dit apparaat',
  'vault.settings.absentHint':
    'Open Kluis in de activiteitenbalk om er een te maken. Dat kost eenmalig een toegangscode en je accountwachtwoord.',
  'vault.settings.group': 'toegangscode',
  'vault.settings.shape': 'Soort',
  'vault.settings.shapeHint':
    'Cijfers typen sneller. Letters en cijfers zijn veel moeilijker te raden, en dat verschil is niet klein.',
  'vault.settings.newPasskey': 'Nieuwe toegangscode',
  'vault.settings.change': 'Toegangscode wijzigen',
  'vault.settings.changing': 'Wijzigen\u2026',
  'vault.settings.changed': 'gewijzigd',
  'vault.settings.note':
    'Een nieuwe toegangscode verzegelt de kluissleutel opnieuw, niet de notities. Er wordt niets in de kluis herschreven, en er komt niets van bij de server.',
  'vault.settings.dangerGroup': 'gevaar',
  'vault.settings.forget': 'Kluis vergeten',
  'vault.settings.forgetHint':
    'Verwijdert de kluis en alles erin van dit apparaat.',
  'vault.settings.forgetCount': {
    one: 'Dat is {count} notitie.',
    other: 'Dat zijn {count} notities.',
  },
  'vault.settings.forgetEmpty': 'Hij is nu leeg.',
  'vault.settings.forgetShut':
    'Wat erin zit gaat mee, en hij is dicht, dus hier valt niet te zeggen hoeveel.',
  'vault.settings.forgetFinal':
    'Er is nergens anders een kopie, dus dit is niet terug te draaien.',
  'vault.settings.deleteIt': 'Verwijderen',
  'vault.settings.keepIt': 'Houden',

  /* --- weergave --------------------------------------------------------- */

  'appearance.group.theme': 'thema',
  'appearance.group.themeHint':
    'Licht of donker is de ene keuze en de kleuren zijn de andere, dus elk palet werkt in allebei. Groen ontbreekt met opzet: het betekent hier versleuteld, en verder mag niets het gebruiken.',
  'appearance.mode': 'Modus',
  'appearance.modeHint': 'Werkt meteen, overal.',
  'appearance.modeFollowing': 'Volgt dit apparaat, en dat staat nu op {mode}.',
  'appearance.theme.dark': 'Donker',
  'appearance.theme.light': 'Licht',
  'appearance.theme.system': 'Systeem',
  'appearance.palette': 'Palet',
  'appearance.paletteHint':
    'Elk palet is een volledige set kleuren, geen tintje over dezelfde app.',
  'appearance.custom': 'Eigen',
  'appearance.customAccent': 'Jouw accentkleur',
  'appearance.customAccentHint':
    'Knoppen, links en je eigen berichten. De tekst die erop komt wordt zwart of wit, net wat leesbaar blijft bij de kleur die je kiest.',
  'appearance.customTint': 'Jouw tint',
  'appearance.customTintHint':
    'De kleur waar de grijzen naartoe leunen: de achtergrond, de panelen en de lijnen ertussen. Twee kleuren in plaats van twintig, omdat de rest hieruit gemengd wordt zodat panelen in het donker lichter blijven dan de grond en overdag donkerder.',

  'appearance.group.wallpaper': 'achtergrond',
  'appearance.group.wallpaperHint':
    'Een foto achter de app, waarbij de panelen een beetje doorschijnend worden zodat je hem ziet. Staat op dit apparaat, op 1600 bij 900, en gaat nergens heen.',
  'appearance.wallpaper': 'Foto',
  'appearance.wallpaperHint': 'Wordt opgerekt tot het venster vol is, welke vorm dat ook heeft.',
  'appearance.dim': 'Dempen',
  'appearance.dimHint': 'Hoeveel van het thema er tussen de foto en de app zit.',
  'appearance.blur': 'Vervagen',
  'appearance.blurHint':
    'Een drukke foto achter tekst is een foto waarop je geen tekst kunt lezen. Dit is de oplossing.',

  'appearance.group.layout': 'indeling',
  'appearance.bar': 'Activiteitenbalk',
  'appearance.barHint':
    'Aan welke rand Direct en Vrienden staan, in een venster dat breed genoeg is om te kiezen. Een zijbalk heeft ruimte naast het gesprek nodig, dus een smal venster valt terug op de onderkant.',
  'appearance.barPhone':
    'Op een telefoon doet dit niets. De app tekent daar zijn eigen balk onderaan, met Direct, Vrienden, Kluis en Instellingen, omdat een telefoonscherm kort is en het enige wat het niet kan missen een tweede rij met dezelfde bestemmingen is.',
  'appearance.bar.top': 'Boven',
  'appearance.bar.left': 'Links',
  'appearance.bar.right': 'Rechts',
  'appearance.bar.bottom': 'Onder',

  'appearance.group.messages': 'berichten',
  'appearance.spacing': 'Ruimte',
  'appearance.spacingHint': 'Hoeveel ruimte een gesprek elke beurt geeft.',
  'appearance.density.cozy': 'Ruim',
  'appearance.density.compact': 'Compact',
  'appearance.textSize': 'Tekstgrootte',
  'appearance.textSizeHint':
    'Alleen de tekst van berichten. De rest van de app blijft staan.',
  'appearance.previewIn': 'Is de nieuwe sleutel bij jou aangekomen?',
  'appearance.previewOut': 'Zelfde nummer als bij jou. Het klopt.',

  'appearance.group.motion': 'beweging',
  'appearance.reduceMotion': 'Minder beweging',
  'appearance.reduceMotionHint':
    'Haalt overgangen en animaties door de hele app weg.',

  'appearance.group.advanced': 'geavanceerd',
  'appearance.ciphertext': 'Cijfertekst tonen',
  'appearance.ciphertextHint':
    'Zet de verzegelde bytes onder elk bericht, zoals de server ze bewaart. Handig om te zien dat er echt versleuteld wordt; rommelig om iets in te lezen.',
  'appearance.note':
    'De weergave staat op dit apparaat. Log je ergens anders in, dan begin je daar bij de standaardinstellingen.',

  /* --- aanwezigheid ----------------------------------------------------- */

  'profile.capture.profile':
    'Profiel',
  'profile.capture.profileHint':
    'Naam, foto, banner, accent, over jou en status.',
  'profile.capture.theme':
    'Kleuren',
  'profile.capture.themeHint':
    'Licht of donker, het palet, en een eigen palet als je er een schreef.',
  'profile.capture.wallpaper':
    'Achtergrond',
  'profile.capture.wallpaperHint':
    'De afbeelding achter de app, en hoe sterk die gedimd en vervaagd is.',
  'profile.capture.layout':
    'Indeling',
  'profile.capture.layoutHint':
    'Aan welke rand de activiteitenbalk staat, de regelafstand en de tekstgrootte.',
  'profile.captures':
    'Wat deze onthoudt',
  'switcher.open':
    'Zoek of begin een gesprek',
  'switcher.placeholder':
    'Waar wil je heen?',
  'switcher.none':
    'Niemand met die naam.',
  'switcher.start':
    'Beginnen',
  'chat.spoiler':
    'Spoiler, klik om te tonen',
  'chat.notSent':
    'Niet verzonden',
  'chat.retry':
    'Opnieuw proberen',
  'chat.copyMessage':
    'Bericht kopiëren',
  'chat.seen':
    'Gezien',
  'person.mute':
    'Meldingen dempen',
  'person.unmute':
    'Dempen opheffen',
  'vault.setup.pointGate':
    'Bewust niet je accountwachtwoord. Het is een tweede slot, zodat een scherm dat iemand ontgrendeld aantreft nog steeds geen open kluis is.',
  'vault.setup.pointSealed':
    'Echt versleuteld, onder een sleutel die dit apparaat niet verlaat. Zonder de toegangscode of je accountwachtwoord gaat hij niet open, en met alleen je accountsleutel ook niet.',
  'vault.setup.pointDevice':
    'Alleen dit apparaat. Er gaat niets naar buiten, dus hij reist nog niet mee naar een andere browser.',
  'presence.online': 'Online',
  'presence.idle': 'Afwezig',
  'presence.dnd': 'Niet storen',
  'presence.offline': 'Offline',
  'presence.invisible': 'Onzichtbaar',

  /* --- je profiel ------------------------------------------------------- */

  'profile.group.picture': 'foto',
  'profile.avatar': 'Profielfoto',
  'profile.avatarHint':
    'Jij kiest het vierkant; het wordt geschaald naar 128px. Alles wat het bestand meedroeg (ook waar een telefoonfoto is genomen) valt daarbij weg.',
  'profile.banner': 'Banner',
  'profile.bannerHint':
    'De band bovenaan je kaart. Breed en laag, dus een foto van een gezicht is er zelden de goede voor.',
  'profile.upload': 'Uploaden',
  'profile.replace': 'Vervangen',
  'profile.badImage': 'Die afbeelding kon niet worden gebruikt.',
  'profile.accent': 'Accentkleur',
  'profile.accentAuto': 'Automatisch, een kleur gekozen uit je account',
  'profile.accentHint':
    'Wordt gebruikt achter je naam en overal waar je foto niet past.',
  'profile.accentHintNoPic': 'Het vlak dat je krijgt tot je een foto uploadt.',

  'profile.group.identity': 'identiteit',
  'profile.displayName': 'Weergavenaam',
  'profile.displayNameHint':
    'Wat mensen zien in plaats van je gebruikersnaam. Laat het leeg om je gebruikersnaam te gebruiken.',
  'profile.presence': 'Aanwezigheid',
  'profile.presenceHint': 'Wat je contacten te horen krijgen dat je aan het doen bent.',

  'profile.group.about': 'over jou',
  'profile.aboutHint':
    'Een paar regels over jezelf, in je eigen woorden. Regeleindes blijven precies staan zoals je ze typt.',
  'profile.about': 'Over jou',
  'profile.aboutPlaceholder':
    'Waar je van houdt, waar je zit, wanneer je meestal wakker bent. Alles wat iemand mag weten voordat die je een bericht stuurt.',
  'profile.note':
    'Je naam, foto, banner, accentkleur, aanwezigheid en tekst over jou staan onversleuteld op de server en zijn alleen voor je vrienden te zien. Al het andere in de instellingen, de opgeslagen profielen erbij, blijft op dit apparaat.',
  'profile.reset': 'Profiel herstellen',

  'profile.group.profiles': 'profielen',
  'profile.saved': 'Opgeslagen profielen',
  'profile.new': 'Nieuw',
  'profile.name': 'Naam',
  'profile.nameHint':
    'Alleen jij ziet deze. Al het andere op deze pagina hoort bij het profiel waar het onder staat, en wordt bewaard terwijl je typt.',
  'profile.nameFor': 'Naam voor dit profiel',
  'profile.duplicate': 'Kopiëren',
  'profile.copyOf': '{name} kopie',
  'profile.deleteNote':
    'Een opgeslagen profiel vergeten verandert niets aan hoe je er nu uitziet. Wat je aanhebt blijft precies zoals het is, het hoort alleen niet meer bij een naam.',
  'profile.keepThis': 'Deze bewaren',
  'profile.keepThisHint':
    'Bewaar hoe je er nu uitziet onder een naam. Maak er daarna nog een, en wissel wanneer je er zin in hebt.',
  'profile.notSaved': 'Niet bewaard',
  'profile.notSavedHint':
    'Je hebt geen van de opgeslagen profielen aan. Bewaar deze ook, of kies er hierboven een.',
  'profile.limit': 'Dat zijn ze alle {max}. Verwijder er een om een nieuwe te maken.',
  'profile.limitShort': '{max} is het maximum.',

  /* --- profielkaart van iemand ------------------------------------------ */

  'userProfile.close': 'Profiel sluiten',
  'userProfile.status': 'Status',
  'userProfile.nickname': 'Bijnaam',
  'userProfile.onlyYou': 'alleen jij ziet dit',
  'userProfile.friendsSince': 'Vrienden sinds',
  'userProfile.message': 'Bericht',
  'userProfile.addNickname': 'Bijnaam toevoegen',
  'userProfile.changeNickname': 'Bijnaam wijzigen',
  'userProfile.unfriend': 'Vriend verwijderen',
  'userProfile.block': 'Blokkeren',

  /* --- wachtwoordregels ------------------------------------------------- */

  'password.problem.short': 'Gebruik minstens {min} tekens.',
  'password.problem.common': 'Dat is gebaseerd op een heel gangbaar wachtwoord.',
  'password.problem.repeated': 'Dat is steeds hetzelfde teken.',
  'password.problem.sequence': 'Dat is een reeks van het toetsenbord of het alfabet.',
  'password.problem.email': 'Gebruik je e-mailadres niet in je wachtwoord.',
  'password.problem.username': 'Gebruik je gebruikersnaam niet in je wachtwoord.',

  /* --- het account ------------------------------------------------------ */

  'account.signedOut':
    'Je bent niet ingelogd op een server, dus er is geen account om te wijzigen. De rest van de instellingen werkt gewoon: die hoort allemaal bij dit apparaat.',
  'account.group': 'account',
  'account.username': 'Gebruikersnaam',
  'account.usernameHint':
    'Hoe je wordt aangesproken. Zichtbaar voor iedereen met wie je praat.',
  'account.email': 'E-mailadres',
  'account.emailHint':
    'Om in te loggen, en om je te bereiken als je ooit je wachtwoord kwijtraakt.',
  'account.unverifiedHint': 'Nog niet bevestigd.',
  'account.unverified': 'niet bevestigd',
  'account.since': 'Lid sinds',
  'account.lastLogin': 'Laatst ingelogd',

  'account.group.username': 'gebruikersnaam wijzigen',
  'account.newUsername': 'Nieuwe gebruikersnaam',
  'account.usernameDone': 'Gebruikersnaam bijgewerkt.',
  'account.saving': 'Opslaan\u2026',

  'account.group.email': 'e-mailadres wijzigen',
  'account.group.emailHint':
    'Je inlogsleutel wordt afgeleid van je adres, dus die wordt bij een wijziging opnieuw afgeleid. Je berichten merken er niets van: die zijn ingepakt onder een sleutel die niet van je e-mailadres afhangt.',
  'account.newEmail': 'Nieuw e-mailadres',
  'account.emailSent': 'Kijk op het nieuwe adres voor een bevestigingslink.',
  'account.sending': 'Versturen\u2026',
  'account.sendConfirmation': 'Bevestiging sturen',

  'account.group.password': 'wachtwoord wijzigen',
  'account.group.passwordHint':
    'Je wachtwoord verlaat dit apparaat nooit. Het pakt hier je privésleutel opnieuw in, en alleen het ingepakte resultaat gaat omhoog. Je herstelcode blijft werken.',
  'account.password': 'Wachtwoord',
  'account.currentPassword': 'Huidig wachtwoord',
  'account.newPassword': 'Nieuw wachtwoord',
  'account.confirmPassword': 'Nieuw wachtwoord bevestigen',
  'account.mismatch': 'Die twee zijn niet gelijk.',
  'account.changePassword': 'Wachtwoord wijzigen',
  'account.changing': 'Wijzigen\u2026',
  'account.passwordDone': 'Wachtwoord gewijzigd.',

  'account.delete': 'Dit account verwijderen',
  'account.deleteHint':
    'Je berichten zijn versleuteld naar een sleutel die alleen jij hebt. Het account verwijderen vernietigt die sleutel, dus niets van wat ooit naar je is gestuurd is nog te lezen, niet door jou en niet door iemand anders. Er is geen weg terug.',
  'account.deleteButton': 'Account verwijderen',
  'account.typeToConfirm': 'Typ {email} om te bevestigen',
  'account.deleteForever': 'Definitief verwijderen',
  'account.deleting': 'Verwijderen\u2026',
  'account.deleteDone': 'Account verwijderd.',

  /* --- apparaten en sleutels -------------------------------------------- */

  'devices.group.number': 'beveiligingsnummer',
  'devices.noKey':
    'Nog geen sleutel op dit apparaat, dus er is geen nummer om te vergelijken.',
  'devices.deviceLocked':
    'Dit apparaat is vergrendeld. Ontgrendel het om je beveiligingsnummer te zien.',
  'devices.needAccount':
    'Sessies en de herstelcode staan op de server, dus daar is een ingelogd account voor nodig.',
  'devices.gate': 'Verborgen tot je bevestigt dat jij het bent',
  'devices.gateWhy':
    'Je beveiligingsnummer en je herstelcode zitten hier allebei achter. Je hebt dit apparaat een tijd geleden ontgrendeld; dit vraagt het opnieuw voordat een van beide op het scherm komt.',
  'devices.gateHint':
    'Wordt op dit apparaat gecontroleerd tegen je eigen opgeslagen sleutel. Er gaat niets ergens heen, en je wachtwoord wordt door dit scherm niet bewaard.',
  'devices.wrongPassword': 'Dat is niet je wachtwoord.',
  'devices.checking': 'Controleren\u2026',
  'devices.reveal': 'Tonen',
  'devices.numberHint':
    'Lees het elkaar hardop voor, of vergelijk het in het echt. Tonen twee apparaten hetzelfde nummer, dan zit er niemand tussen jullie gesprek. Verandert het ooit zonder uitleg, stop dan en vraag waarom voordat je iets stuurt.',
  'devices.noFingerprint':
    'Dit apparaat heeft geen sleutel om een vingerafdruk van te maken.',
  'devices.keyState': 'Sleutelstatus',
  'devices.state.unlocked': 'Ontgrendeld. Berichten zijn op dit apparaat te lezen',
  'devices.state.locked': 'Vergrendeld. De sleutel is hier, het wachtwoord niet',
  'devices.state.empty': 'Geen sleutel op dit apparaat',
  'devices.hide': 'Weer verbergen',

  'devices.group.recovery': 'herstelcode',
  'devices.newCode':
    'Dit is je nieuwe code. De oude stopte met werken op het moment dat deze werd gemaakt, en dit is de enige keer dat hij te zien is.',
  'devices.savedIt': 'Ik heb hem bewaard',
  'devices.recoveryHint':
    'Het enige dat je berichten kan openen zonder je wachtwoord. Opnieuw genereren maakt een nieuwe code en zet de oude buiten werking; je berichten en je beveiligingsnummer blijven onaangeroerd.',
  'devices.recoveryNote':
    'Je huidige code is niet nog eens te tonen. Alleen de hash ervan staat op de server, en de kopie van je sleutel die hij bewaakt is vergrendeld met de code zelf, dus er is hier niets dat terug te rekenen is naar die code. Ben je hem kwijt, maak dan een nieuwe.',
  'devices.generateNew': 'Een nieuwe code maken',
  'devices.recoveryPasswordHint':
    'Nodig om de sleutel uit te pakken voordat hij onder de nieuwe code opnieuw kan worden ingepakt.',
  'devices.generate': 'Maken',
  'devices.generating': 'Maken\u2026',
  'devices.recoveryDone': 'Nieuwe herstelcode gemaakt.',

  'devices.group.sessions': 'ingelogd',
  'devices.sessionsHint':
    'Een sessie uitloggen beëindigt de toegang tot de server. Het reikt niet in dat apparaat om daar iets te wissen dat al ontsleuteld is.',
  'devices.loading': 'Laden\u2026',
  'devices.noSessions': 'Geen andere sessies.',
  'devices.unknownDevice': 'Onbekend apparaat',
  'devices.thisDevice': 'dit apparaat',
  'devices.since': 'sinds {day}',
  'devices.signingOut': 'Uitloggen\u2026',
  'devices.refresh': 'Vernieuwen',
  'devices.signOutEverywhere': 'Overal uitloggen',

  /* --- namen van geluiden ----------------------------------------------- */

  'sound.ding': 'Ding',
  'sound.orb': 'Bol',
  'sound.bell': 'Bel',
  'sound.blip': 'Blip',
  'sound.knock': 'Klop',
  'sound.glass': 'Glas',
  'sound.hush': 'Zucht',
  'sound.chirp': 'Tjilp',
  'sound.arpeggio': 'Arpeggio',
  'sound.villageBells': 'Kerkklokken',
  'sound.hollow': 'Hol',
  'sound.clock': 'Klok',
  'sound.ripple': 'Rimpeling',
  'sound.door': 'Deur',
  'sound.fanfare': 'Fanfare',
  'sound.ringback': 'Kiestoon',
  'sound.connected': 'Verbonden',
  'sound.hungUp': 'Opgehangen',

  /* --- meldingen -------------------------------------------------------- */

  'notify.group.pause': 'pauze',
  'notify.pause': 'Meldingen pauzeren',
  'notify.pauseHint':
    'Er klinkt en verschijnt niets tijdens de pauze. Berichten komen gewoon aan.',
  'notify.paused': 'Gepauzeerd {when}.',
  'notify.untilYouSay': 'tot je het weer aanzet',
  'notify.untilTime': 'tot {time}',
  'notify.resume': 'Hervatten',
  'notify.mute.30m': '30 minuten',
  'notify.mute.2h': '2 uur',
  'notify.mute.tomorrow': 'Tot morgen',
  'notify.mute.forever': 'Tot ik het weer aanzet',

  'notify.group.desktop': 'bureaublad',
  'notify.unsupported': 'Deze versie kan geen bureaubladmeldingen tonen.',
  'notify.denied':
    'Meldingen zijn voor deze app geblokkeerd in je browser of systeeminstellingen. Dat moet daar worden gewijzigd, want dit scherm kan er niet overheen.',
  'notify.desktop': 'Bureaubladmeldingen',
  'notify.desktopHint':
    'Een pop-up als er een bericht komt terwijl de app op de achtergrond staat.',
  'notify.allow': 'Toestaan',
  'notify.preview': 'Berichttekst in meldingen tonen',
  'notify.previewHint':
    'Uit zegt een melding alleen dat iemand je iets stuurde. Aan staat erbij wat diegene zei, en dat geeft ontsleutelde tekst aan het meldingencentrum van je besturingssysteem, waar het gelogd kan worden, naar een ander apparaat gespiegeld, of op een vergrendeld scherm getoond.',
  'notify.previewWarn':
    'Berichttekst gaat bij elke melding buiten het bereik van de app.',
  'notify.toast':
    'Pop-up in de app tonen',
  'notify.toastHint':
    'Een kaartje in de hoek als er een bericht binnenkomt in een gesprek dat je niet leest. Precies het tegenovergestelde van een bureaubladmelding: deze verschijnt alleen als je de app kunt zien, die andere alleen als dat niet zo is, dus een bericht geeft altijd de een of de ander en nooit allebei.',
  'notify.toastPreview':
    'Berichttekst in pop-ups tonen',
  'notify.toastPreviewHint':
    'Los van de instelling hierboven, omdat het risico anders is. Een pop-up wordt getekend in een venster waar je toch al naar kijkt en gaat nergens anders heen, dus hij staat aan. Zet hem uit als mensen over je schouder meelezen.',
  'notify.toastDismiss':
    'Sluiten',
  'notify.test': 'Probeer er een',
  'notify.testHint':
    'Meldingen verschijnen alleen als dit venster op de achtergrond staat, dus dit is de enige melding die je niet kunt controleren door hem aan te zetten en te wachten.',
  'notify.testSend': 'Laat er nu een zien',
  'notify.testTitle': 'Cipher',
  'notify.testBody': 'Meldingen werken. Zo ziet er een eruit.',
  'notify.mentionedYou': 'Noemde jou',

  'notify.group.sounds': 'geluiden',
  'notify.newMessage': 'Nieuw bericht',
  'notify.soundOnMessage': 'Geluid bij een nieuw bericht',
  'notify.messageSound': 'Berichtgeluid',
  'notify.messageSoundHint':
    'Elk geluid wordt ter plekke gemaakt, dus geen ervan kost de app een download.',
  'notify.ringtone': 'Beltoon',
  'notify.ringtoneHint':
    'Speelt tot je opneemt, dus kies er een die je twee keer kunt verdragen.',
  'notify.mentions': 'Vermeldingen',
  'notify.mentionsHint':
    'Apart gehouden zodat je stil kunt zijn zonder doof te worden.',
  'notify.soundOnMention': 'Geluid bij een vermelding',
  'notify.sent': 'Bericht verstuurd',
  'notify.soundOnSend': 'Geluid bij een verstuurd bericht',
  'notify.play': '{what} afspelen',

  'notify.group.perPerson': 'per persoon',
  'notify.perPersonEmpty':
    'Voeg iemand toe bij Vrienden en diegene verschijnt hier, met een eigen berichtgeluid en beltoon.',
  'notify.perPersonLede':
    'Geef de mensen van wie je het meest hoort hun eigen geluid. Wie op "Voor iedereen hetzelfde" blijft staan gebruikt de twee instellingen hierboven.',
  'notify.sameForEveryone': 'Voor iedereen hetzelfde',
  'notify.messageSoundFor': 'Berichtgeluid voor {name}',
  'notify.ringtoneFor': 'Beltoon voor {name}',
  'notify.defaultMessageSound': 'het standaard berichtgeluid',
  'notify.defaultRingtone': 'de standaard beltoon',

  'notify.group.badges': 'tellers',
  'notify.badge': 'Aantal ongelezen',
  'notify.badgeHint': 'Het getal op het app-icoon en in de tabtitel.',

  'notify.callTitle': 'Inkomende oproep',
  'notify.callFrom': '{name} belt je.',
  'notify.callSomeone': 'Iemand belt je.',

  /* --- de desktop-app --------------------------------------------------- */

  'desktop.notDesktop':
    'Deze versie draait niet in de desktop-app, dus hier valt niets in te stellen.',
  'desktop.group.app': 'deze app',
  'desktop.version': 'Versie',
  'desktop.versionHint': 'De geïnstalleerde desktop-app. De chat zelf zit erin.',
  'desktop.updates': 'Updates',
  'desktop.updatesHint':
    'Gecontroleerd bij het starten en daarna elke paar uur. Een update wordt alleen geïnstalleerd als jij dat zegt.',
  'desktop.installVersion': 'Installeer {version} en herstart',
  'desktop.checkNow': 'Nu controleren',
  'desktop.checking': 'Controleren…',
  'desktop.upToDate': 'Je hebt de nieuwste versie.',
  'desktop.devBuild': 'Dit is een ontwikkelversie. Die controleert nooit op updates.',
  'desktop.checkFailed': 'Controleren mislukte: {message}',
  'desktop.ready': 'Cipher {version} staat klaar.',
  'desktop.noRestart':
    'De update is geïnstalleerd, maar de app is niet herstart. Start hem zelf opnieuw.',
  'desktop.group.window': 'venster',
  'desktop.closeToTray': 'Blijf draaien als het venster wordt gesloten',
  'desktop.closeToTrayHint':
    'De app blijft in het systeemvak, dus berichten en oproepen bereiken je nog. Uit, dan sluit het venster de app af. Afsluiten kan altijd via het menu in het systeemvak.',
  'desktop.autostart': 'Starten als je inlogt op je computer',
  'desktop.autostartHint':
    'Opent in het systeemvak zonder het venster te tonen, zodat je bereikbaar bent voordat je eraan hebt gedacht.',

  'update.ready': 'Cipher {version} staat klaar om te installeren.',
  'update.failed': 'Bijwerken mislukte: {message}',
  'update.restart': 'Herstart om bij te werken',
  'update.later': 'Later',
  'update.downloading': 'Downloaden…',
  'update.downloadingPercent': 'Downloaden… {percent}%',
  'update.downloadingBytes': 'Downloaden… {amount}',
  'update.installing': 'Controleren en installeren…',

  /* --- spraak en video -------------------------------------------------- */

  'voice.unsupported':
    'Deze versie heeft geen toegang tot media-apparaten, dus hier valt niets in te stellen.',
  'voice.unnamed':
    'Je browser verbergt apparaatnamen tot je een keer toegang geeft. Tot die tijd staan de lijsten hieronder naamloos.',
  'voice.allowMic': 'Microfoon toestaan',
  'voice.allowCamera': 'Camera toestaan',
  'voice.systemDefault': 'Standaard van het systeem',

  'voice.group.voice': 'spraak',
  'voice.input': 'Invoerapparaat',
  'voice.inputHint': 'Welke microfoon gesprekken gebruiken.',
  'voice.inputVolume': 'Invoervolume',
  'voice.output': 'Uitvoerapparaat',
  'voice.outputHint': 'Waar het geluid van een gesprek uit komt.',
  'voice.outputFixed':
    'Deze browser speelt altijd via de standaard van het systeem, dus er valt niets te kiezen.',
  'voice.outputVolume': 'Uitvoervolume',

  'voice.group.mode': 'invoermodus',
  'voice.whenOpen': 'Wanneer je microfoon openstaat',
  'voice.mode.activity': 'Spraakactivatie',
  'voice.mode.push': 'Druk om te praten',
  'voice.sensitivity': 'Gevoeligheid',
  'voice.sensitivityHint':
    'Hoe hard je moet zijn voordat je wordt doorgestuurd. Kijk naar de meter hieronder en zet hem net boven je kamer.',
  'voice.testMic': 'Microfoon testen',
  'voice.stopTest': 'Test stoppen',
  'voice.saySomething': 'Zeg iets, de balk hoort te bewegen.',
  'voice.wouldBeHeard': 'Je zou te horen zijn.',
  'voice.belowThreshold': 'Onder de drempel, er zou niets worden verstuurd.',
  'voice.micFailed': 'Die microfoon kon niet worden geopend.',

  'voice.group.processing': 'bewerking',
  'voice.processingHint':
    'Wordt door de audiolaag van de browser gedaan. Zet ze uit als je een interface gebruikt die dit zelf al doet.',
  'voice.echo': 'Echo-onderdrukking',
  'voice.noise': 'Ruisonderdrukking',
  'voice.gain': 'Automatische versterking',

  'voice.group.video': 'video',
  'voice.camera': 'Camera',
  'voice.mirror': 'Mijn camera spiegelen',
  'voice.mirrorHint': 'Verandert alleen je eigen voorbeeld, niet wat anderen zien.',
  'voice.cameraOff': 'Camera uit',
  'voice.previewCamera': 'Camera bekijken',
  'voice.stopPreview': 'Voorbeeld stoppen',
  'voice.cameraFailed': 'Die camera kon niet worden geopend.',
  'voice.note':
    'Spraakgesprekken gebruiken de microfoon, de luidspreker en de invoermodus die hier zijn gekozen. Volume, modus en gevoeligheid veranderen een gesprek dat al loopt; een andere microfoon of luidspreker geldt vanaf het volgende. De camera wordt bewaard voor later: gesprekken zijn voorlopig alleen spraak.',

  /* --- inloggen en account maken ---------------------------------------- */

  'auth.signIn': 'Inloggen',
  'auth.signingIn': 'Inloggen\u2026',
  'auth.welcomeBack': 'Welkom terug.',
  'auth.email': 'E-mailadres',
  'auth.password': 'Wachtwoord',
  'auth.username': 'Gebruikersnaam',
  'auth.usernameHint': 'Letters, cijfers en losse . _ - ertussen.',
  'auth.resent': 'Verstuurd. Kijk in je inbox voor een nieuwe link.',
  'auth.resend': 'De bevestigingsmail opnieuw sturen',
  'auth.forgot': 'Wachtwoord vergeten?',
  'auth.noAccount': 'Nog geen account?',
  'auth.createOne': 'Maak er een',
  'auth.haveAccount': 'Heb je al een account?',

  'auth.create': 'Een account maken',
  'auth.createLede': 'Kies een naam waarop mensen je kunnen vinden, en een wachtwoord.',
  'auth.createButton': 'Account maken',
  'auth.settingUp': 'Alles klaarzetten\u2026',
  'auth.passwordWarn':
    'Er bestaat geen wachtwoordherstel dat je berichten meeneemt. Kies iets dat je over een jaar nog hebt.',

  'auth.recovery.title': 'Bewaar je herstelcode',
  'auth.recovery.lede':
    'Deze wordt één keer getoond, en het is de enige weg terug naar je berichten als je je wachtwoord vergeet. Niemand kan hem je later toesturen.',
  'auth.recovery.write':
    'Schrijf hem ergens op papier, of zet hem in een wachtwoordmanager.',
  'auth.recovery.withoutIt':
    'Zonder die code betekent een vergeten wachtwoord dat je elk bericht kwijt bent dat je ooit hebt ontvangen.',
  'auth.recovery.confirm':
    'Ik heb deze code ergens bewaard waar ik hem later nog heb.',
  'auth.continue': 'Doorgaan',

  'auth.forgotTitle': 'Wachtwoord vergeten',
  'auth.forgotLede':
    'Geef het adres van het account, dan sturen we een link om een nieuw wachtwoord in te stellen.',
  'auth.sendLink': 'Stuur de link',
  'auth.checkEmail': 'Kijk in je e-mail',
  'auth.resetSent':
    'Als er een account is voor {email}, is er een link onderweg om een nieuw wachtwoord in te stellen. Hij werkt één keer en vervalt na een uur.',
  'auth.resetHaveCode':
    'Houd je herstelcode bij de hand. Het is het enige dat je bestaande berichten kan meenemen naar het nieuwe wachtwoord, en niemand hier kan hem je toesturen.',
  'auth.verifySent':
    'We hebben een bevestigingslink gestuurd. Open die, kom dan terug en log in.',
  'auth.checkSpam':
    'Binnen een minuut niets? Kijk in je spammap, daar belandt hij in het begin meestal.',
  'auth.backToSignIn': 'Terug naar inloggen',

  /* --- een wachtwoord opnieuw instellen --------------------------------- */

  'reset.checking': 'Je link controleren\u2026',
  'reset.oneMoment': 'Een moment.',
  'reset.badLink': 'Die link werkte niet',
  'reset.badLinkLede':
    'Herstellinks werken één keer en vervallen een uur nadat ze zijn verstuurd, en een nieuwe aanvragen zet de oude buiten werking. Begin opnieuw vanaf het inlogscherm en gebruik de laatste e-mail.',
  'reset.goToSignIn': 'Naar inloggen',
  'reset.newCodeTitle': 'Je nieuwe herstelcode',
  'reset.newCodeLede':
    'De oude code is bij het herstellen verbruikt, dus hier is de code die hem vervangt. Net als de vorige is dit de enige keer dat hij te zien is.',
  'reset.continueToSignIn': 'Verder naar inloggen',

  'reset.title': 'Een nieuw wachtwoord instellen',
  'reset.forEmail': 'Voor {email}.',
  'reset.recoveryCode': 'Herstelcode',
  'reset.recoveryCodeHint':
    'De code die je kreeg toen je het account maakte. Streepjes en hoofdletters maken niet uit.',
  'reset.discardLead': 'Je staat op het punt opnieuw te beginnen met een nieuwe sleutel.',
  'reset.discardWarn':
    'Elk bericht dat al in dit account staat blijft verzegeld onder de oude sleutel, dus het is nooit meer te lezen, niet door jou en niet door iemand anders.',
  'reset.discardKeeps':
    'Je houdt het account, de gebruikersnaam en je vrienden, en nieuwe berichten werken vanaf hier gewoon.',
  'reset.discardConfirm':
    'Ik begrijp dat mijn bestaande berichten voorgoed onleesbaar worden.',
  'reset.setPassword': 'Nieuw wachtwoord instellen',
  'reset.settingUp': 'Instellen\u2026',
  'reset.noCode': 'Ik heb mijn herstelcode niet',
  'reset.foundCode': 'Ik heb mijn herstelcode toch gevonden',

  /* --- het gespreksvenster ---------------------------------------------- */

  'chat.views': 'Weergaven',
  'chat.direct': 'Direct',
  'chat.friends': 'Vrienden',
  'chat.connecting': 'verbinden\u2026',
  'chat.offlineQueue': 'offline, berichten blijven in de wachtrij',
  'chat.notConnected': 'geen verbinding',

  'chat.upload': 'Een bestand uploaden',
  'chat.emoji': 'Een emoji kiezen',
  'chat.send': 'Versturen',
  'chat.typing': {
    one: '{names} is aan het typen\u2026',
    other: '{names} zijn aan het typen\u2026',
  },
  'chat.queuedHint':
    'In de wachtrij op dit apparaat. Ze gaan weg zodra er verbinding is.',

  'chat.loading': 'laden\u2026',
  'chat.unread': {
    one: '{count} ongelezen',
    other: '{count} ongelezen',
  },
  'chat.daysAgo': '{count}d',

  'chat.bot': 'bot',
  'chat.edited': 'bewerkt',
  'chat.lockedFailed': 'Dit bericht kon niet worden geopend.',
  'chat.lockedHere': 'Dit bericht is hier niet te lezen.',
  'chat.intro': 'Dit is het begin van je gesprek met {name}.',
  'chat.keyChanged': 'De beveiligingssleutel van {name} is veranderd.',
  'chat.keyChangedBody':
    'Dat gebeurt na een wachtwoordreset zonder herstelcode, of op een nieuw apparaat. Klopt geen van beide, neem dan eerst op een andere manier contact op. Tot je akkoord gaat wordt er niets naar deze persoon gestuurd en niets nieuws van deze persoon geopend.',
  'chat.keyChangedAccept': 'Nieuwe sleutel vertrouwen',

  'chat.newMessage': 'Nieuw bericht',
  'chat.sectionPinned': 'vastgezet',
  'chat.sectionDirect': 'direct',
  'chat.loadFailed': 'Je gesprekken konden niet worden geladen',
  'chat.loadingTitle': 'Laden\u2026',
  'chat.loadingBody': 'Je gesprekken worden opgehaald.',
  'chat.noneTitle': 'Nog geen gesprekken',
  'chat.noneBody': 'Voeg iemand toe bij Vrienden en begin dan een gesprek met diegene.',
  'chat.you': 'jij',
  'chat.composerTo': 'bericht aan {name}',
  'chat.queued': {
    one: '{count} wacht om verstuurd te worden',
    other: '{count} wachten om verstuurd te worden',
  },

  'chat.profile': 'Profiel',
  'chat.showProfile': 'Profiel tonen',
  'chat.hideProfile': 'Profiel verbergen',
  'chat.code': 'code',
  'chat.copyCode': 'Code kopiëren',
  'chat.copied': 'Gekopieerd',
  'chat.copyFailed': 'Kopiëren mislukt',
  'call.call': 'Bellen',
  'call.callName': '{name} bellen',
  'call.inACall': 'In gesprek',
  'call.alreadyIn': 'Al in gesprek',

  /* --- iets doen met iemand --------------------------------------------- */

  'person.actionsFor': 'Acties voor {name}',
  'person.viewProfile': 'Profiel bekijken',
  'person.removeNickname': 'Bijnaam weghalen',
  'person.pin': 'Bovenaan vastzetten',
  'person.unpin': 'Losmaken',
  'person.pinFull': 'Vastgezet zit vol ({max})',
  'person.failed': 'Dat werkte niet.',
  'person.failedTitle': 'Dat werkte niet',
  'person.unfriendTitle': '{name} verwijderen?',
  'person.unfriendBody':
    'Jullie kunnen elkaar dan niets nieuws meer sturen. Wat er al gezegd is blijft staan, en jullie kunnen het elkaar later opnieuw vragen.',
  'person.blockTitle': '{name} blokkeren?',
  'person.blockBody':
    'Diegene kan je dan niet meer bereiken of opnieuw toevoegen, en krijgt dat niet te horen. Hiermee eindigt ook jullie vriendschap. Je kunt het ongedaan maken bij Vrienden, onder Geblokkeerd.',
  'person.nicknameFor': 'Bijnaam voor {name}',
  'person.nicknameBody':
    'Alleen jij ziet dit. Het vervangt hun gebruikersnaam overal in jouw app, en zij horen er nooit iets van.',
  'person.useUsername': 'Hun gebruikersnaam gebruiken',

  /* --- vrienden --------------------------------------------------------- */

  'friends.tab.all': 'Alle vrienden',
  'friends.tab.add': 'Vriend toevoegen',
  'friends.tab.sent': 'Verstuurd',
  'friends.tab.received': 'Ontvangen',
  'friends.tab.blocked': 'Geblokkeerd',
  'friends.section.friends': 'vrienden',
  'friends.section.sent': 'verstuurd',
  'friends.section.received': 'ontvangen',
  'friends.section.blocked': 'geblokkeerd',

  'friends.noneTitle': 'Nog geen vrienden',
  'friends.noneBody':
    'Voeg iemand toe met de precieze gebruikersnaam die je hebt gekregen, bij Vriend toevoegen.',
  'friends.more': 'Meer',
  'friends.moreFor': 'Meer acties voor {name}',

  'friends.addSomeone': 'iemand toevoegen',
  'friends.addLede':
    'Je hebt hun precieze gebruikersnaam nodig. Er is geen lijst om in te bladeren, en dat is met opzet: dat zou een lijst zijn van iedereen met een account hier.',
  'friends.addPlaceholder': 'hun precieze gebruikersnaam',
  'friends.sendRequest': 'Verzoek sturen',

  'friends.sentNone': 'Niets in afwachting',
  'friends.sentNoneBody':
    'Verzoeken die je stuurt staan hier tot er antwoord komt.',
  'friends.waitingFor': 'wacht op hen',
  'friends.recvNone': 'Niets te beantwoorden',
  'friends.recvNoneBody': 'Verzoeken die anderen je sturen komen hier binnen.',
  'friends.wantsToTalk': 'wil met je praten',
  'friends.accept': 'Accepteren',
  'friends.decline': 'Afwijzen',

  'friends.blockedNone': 'Niemand geblokkeerd',
  'friends.blockedNoneBody':
    'Iemand blokkeren beëindigt de vriendschap en houdt diegene bij je weg. Ze horen er nooit iets van.',
  'friends.blockedOn': 'geblokkeerd op {day}',
  'friends.unblock': 'Deblokkeren',
  'friends.unblocked':
    '{name} is gedeblokkeerd. Jullie zijn weer vreemden, dus ieder van jullie kan een vriendschapsverzoek sturen.',
  'friends.addBack': 'Weer toevoegen',

  'friends.outcome.accepted':
    'Jij en {name} zijn nu vrienden, omdat diegene het al had gevraagd.',
  'friends.outcome.already': 'Je bent al bevriend met {name}.',
  'friends.outcome.sent': 'Verzoek gestuurd naar {name}.',
  'friends.error.generic': 'Dat verzoek kon niet worden verstuurd.',
  'friends.error.notFound':
    'Geen account met die gebruikersnaam. Controleer de spelling, hij moet precies kloppen.',
  'friends.error.self': 'Dat ben jij.',
  'friends.error.blocked':
    'Je hebt deze gebruiker geblokkeerd. Deblokkeer diegene eerst, bij Geblokkeerd.',
  'friends.error.rateLimited': 'Te veel verzoeken voor nu. Probeer het over een uur opnieuw.',
  'friends.error.invalid': 'Dat lijkt niet op een gebruikersnaam.',

  /* --- gesprekken ------------------------------------------------------- */

  'call.someone': 'Iemand',
  'call.unknown': 'Onbekend',
  'call.isCalling': 'belt',
  'call.isCallingYou': '{name} belt',
  'call.calling': 'bellen\u2026',
  'call.dismiss': 'Wegklikken',
  'call.holdToTalk': 'Ingedrukt houden om te praten',
  'call.talking': 'Aan het praten',
  'call.holdHint': 'Houd ingedrukt om te praten, of houd Ctrl+spatie ingedrukt',
  'call.toEarpiece': 'Naar de oorschelp',
  'call.toSpeaker': 'Naar de luidspreker',
  'call.mute': 'Dempen',
  'call.unmute': 'Dempen opheffen',
  'call.cancel': 'Gesprek afbreken',
  'call.hangUp': 'Ophangen',

  'call.end.hangup': 'Gesprek beëindigd',
  'call.end.rejected': '{name} nam niet aan',
  'call.end.noAnswer': 'Geen antwoord',
  'call.end.missed': 'Gemist gesprek van {name}',
  'call.end.disconnected': 'Verbinding verbroken',
  'call.end.busy': '{name} is in een ander gesprek',
  'call.end.inCall': 'Je bent al in gesprek in een ander tabblad',
  'call.end.noMicrophone':
    'Je microfoon kon niet worden geopend. Controleer de toestemming in de browser en het invoerapparaat bij de instellingen.',
  'call.end.unreadable': 'Het gesprek kon met deze persoon niet worden opgezet.',
  'call.end.failed': 'De verbinding mislukte.',
  'call.end.noRelay':
    'Kon geen verbinding maken. Deze server heeft geen relay, dus gesprekken werken alleen als beide kanten elkaar rechtstreeks kunnen bereiken.',
  'call.end.refused': 'Het gesprek kon niet worden opgezet.',
  'call.end.passthrough': '{message}',

  /* --- de schil --------------------------------------------------------- */

  'strip.thisAccount': 'dit account',
  'load.backOnline': 'Weer online',
  'load.backOnlineDetail': 'Alles wat klaarstond is onderweg.',

  'load.title.boot': 'Opstarten',
  'load.title.slow': 'Opnieuw verbinden',
  'load.title.offline': 'Geen verbinding',
  'load.detail.boot': 'De sleutels van dit apparaat openen.',
  'load.detail.slow':
    'De verbinding viel weg. Niets van wat je hebt geschreven is kwijt, het verstuurt zichzelf.',
  'load.detail.offline':
    'Wachten op een netwerk. Wat je nu schrijft blijft op dit apparaat in de wachtrij staan.',
  'load.boot.keys': 'De sleutelopslag van dit apparaat openen.',
  'load.boot.session': 'Nagaan of je nog bent ingelogd.',
  'load.boot.ready': 'Klaar.',
  'load.didYouKnow': 'wist je dat',
  'load.tip.privateKey':
    'Je privésleutel wordt op dit apparaat gemaakt en gaat nooit naar de server.',
  'load.tip.perDevice':
    'Berichten worden per apparaat verzegeld, ook voor jezelf, zodat je geschiedenis met je meegaat.',
  'load.tip.ciphertext':
    'De server bewaart cijfertekst. Hij kan je berichten niet doorzoeken, en wij ook niet.',
  'load.tip.lostKey':
    'Raak je je wachtwoord en je sleutel kwijt, dan gaat je geschiedenis mee. Dat is de afruil.',
  'load.tip.queued':
    'Een bericht dat je offline schrijft blijft hier in de wachtrij staan, het verdwijnt niet, en gaat weg zodra je weer verbinding hebt.',
  'load.tip.securityNumber':
    'Controleer het beveiligingsnummer van een contact langs een andere weg voordat je het slotje vertrouwt.',

  /* --- ontgrendelen, bevestigen, en een dood adres ---------------------- */

  'unlock.title': 'Ontgrendel je berichten',
  'unlock.lede':
    'Ingelogd als {account}. Vul je wachtwoord in om verder te gaan waar je gebleven was.',
  'unlock.go': 'Ontgrendelen',
  'unlock.unlocking': 'Ontgrendelen\u2026',
  'unlock.signOutInstead': 'Toch uitloggen',

  'verify.working': 'Bevestigen\u2026',
  'verify.done': 'E-mailadres bevestigd',
  'verify.doneLede': 'Je adres is bevestigd. Je kunt nu inloggen.',
  'verify.failedLede':
    'Waarschijnlijk is hij al gebruikt. Bevestigingslinks werken één keer en vervallen daarna, dus als je deze eerder hebt geopend is je adres bevestigd en kun je gewoon inloggen. Vraag anders een nieuwe link aan op het inlogscherm; links vervallen ook na 24 uur.',

  /* --- de link om je e-mailadres te wijzigen ------------------------------ */

  'changeEmail.title': 'Bevestig je nieuwe e-mailadres',
  'changeEmail.lede':
    'Deze link verhuist je account naar {email}. Je inlogsleutel wordt afgeleid van je adres, dus die wordt nu opnieuw afgeleid, op dit apparaat. Je berichten blijven zoals ze zijn.',
  'changeEmail.checking': 'Je link controleren…',
  'changeEmail.confirm': 'Verhuizen naar het nieuwe adres',
  'changeEmail.confirming': 'Verhuizen…',
  'changeEmail.done': 'E-mailadres gewijzigd',
  'changeEmail.doneLede': 'Log voortaan in met {email}.',
  'changeEmail.signedOut':
    'Log eerst in en open deze link dan opnieuw. Hij werkt alleen voor het account dat erom vroeg.',
  'changeEmail.badLinkLede':
    'Hij is al gebruikt, hij is verlopen (links gelden een uur) of hij hoort bij een ander account.',
  'changeEmail.back': 'Terug naar de app',

  'notFound.title': 'Deze pagina bestaat niet',
  'notFound.lede':
    'Cipher heeft niets op dit adres. Waarschijnlijk is het verkeerd getypt, of wees het naar iets dat sindsdien is verplaatst.',
  'notFound.home': 'Terug naar je berichten',
  'notFound.back': 'Terug',
  'notFound.foot': 'Er is niets kwijt. Je gesprekken staan nog waar je ze achterliet.',

  /* --- foto's en velden ------------------------------------------------- */

  'avatar.notAnImage': 'Dat bestand is geen afbeelding.',
  'avatar.tooBig': 'Die afbeelding is groter dan 8 MB. Probeer een kleinere.',
  'avatar.unsupported': 'Deze browser kan hier geen afbeeldingen lezen.',
  'avatar.unreadable': 'Die afbeelding kon niet worden gelezen.',
  'avatar.notResized': 'Die afbeelding kon niet worden geschaald.',

  'crop.title': 'Zet je foto goed',
  'crop.body':
    'Sleep om hem te verplaatsen, knijp of scroll om te zoomen. Alleen het vierkant dat je houdt wordt bewaard. De rest van het bestand verlaat dit venster nooit.',
  'crop.bannerTitle': 'Zet je banner goed',
  'crop.bannerBody':
    'Sleep om hem te verplaatsen, knijp of scroll om te zoomen. De band die je houdt is wat je kaart laat zien, en de rest van het bestand verlaat dit venster nooit.',
  'crop.wallpaperTitle': 'Zet je achtergrond goed',
  'crop.wallpaperBody':
    'Sleep om hem te verplaatsen, knijp of scroll om te zoomen. Hij wordt bewaard op 1600 bij 900 en opgerekt tot je venster vol is, welke vorm dat ook heeft.',
  'crop.position': 'Positie van de foto. Met de pijltjestoetsen verplaats je de foto.',
  'crop.zoom': 'Zoom',
  'crop.recentre': 'Opnieuw centreren',

  'field.showPassword': 'Wachtwoord tonen',
  'field.hidePassword': 'Wachtwoord verbergen',

  /* --- fouten die de app zelf benoemt ----------------------------------- */

  'error.deviceLocked':
    'Dit apparaat is vergrendeld. Vul je wachtwoord in om je berichten te ontgrendelen.',
  'error.identityUnavailable':
    'Ingelogd, maar de versleutelingssleutel van dit account kon niet worden geopend.',
  'error.wrongRecoveryCode': 'Die herstelcode hoort niet bij dit account.',
  'error.network': 'Kon de server niet bereiken',
  'error.timeout': 'De server deed er te lang over om te antwoorden',
  'error.rejected': 'De server wees dat verzoek af',
  'error.unauthorized': 'Je bent niet ingelogd',
  'error.forbidden': 'Je hebt daar geen toegang toe',
  'error.notFound': 'Niet gevonden',
  'error.rateLimited': 'Te veel pogingen. Probeer het later opnieuw.',
  'error.server': 'Er ging iets mis op de server',
  'error.requestFailed': 'Het verzoek mislukte',
};
